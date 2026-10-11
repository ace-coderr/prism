// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  PrismReviews
 * @notice Reviews that can't lie: only holders of a token can review it, each review records how
 *         much the reviewer held, and if they sell, anyone can mark the review SOLD for everyone.
 *
 *         - `post(token, rating, text)`: rating 1–5 and up to 280 bytes of text, only while the
 *           caller holds some of `token`. The review stores the balance at that moment; the text
 *           lives in the event. One current review per author per token: posting again (while
 *           still holding, after a cooldown) adds a new review linked to the one it replaces.
 *         - `markSold(id)`: anyone can call it. If the author now holds less than half of what
 *           they held when posting, the review is SOLD, permanently.
 *         - Reviews are never deleted and never edited; nothing can undo SOLD.
 *
 *         No owner, no admin, no fees, no upgrades, no pause. It never holds funds: nothing in it
 *         is payable and it has no receive/fallback, so any ETH sent with a call is refused.
 *         Balances are read with view calls only (STATICCALL): a token can't call back into it.
 */
contract PrismReviews {
    enum Status {
        None, // no such review
        Active, // the author's current review for this token
        Replaced, // the author posted a newer one (see `previous` of that one)
        Sold // the author sold after posting (below half of `heldAtPost`): permanent
    }

    struct Review {
        address author;
        uint8 rating;
        Status status;
        uint40 postedAt;
        uint40 soldAt; // 0 unless Sold
        address token;
        uint64 previous; // the review this one replaced, 0 = none
        uint256 heldAtPost; // the author's balance of `token` when posting
    }

    uint256 public constant MAX_TEXT_BYTES = 280;
    /// @notice Time between two reviews of the same token by the same author (spam limit).
    uint256 public constant UPDATE_COOLDOWN = 1 hours;

    /// @dev Review ids start at 1; 0 means "none".
    uint64 private _count;
    mapping(uint256 id => Review) private _reviews;
    /// @dev The author's latest review of the token (Active, or Sold if that's where it ended).
    mapping(address author => mapping(address token => uint64 id)) private _latest;

    event ReviewPosted(
        uint256 indexed id,
        address indexed author,
        address indexed token,
        uint8 rating,
        uint256 heldAtPost,
        uint256 previous,
        string text
    );
    event ReviewSold(uint256 indexed id, address indexed author, address indexed token, uint256 balance, uint256 heldAtPost);

    error InvalidRating(uint8 rating);
    error TextTooLong(uint256 length);
    error NotAToken(address token);
    error NotHolder(address token);
    error TooSoon(uint256 availableAt);
    error UnknownReview(uint256 id);
    error NotActive(uint256 id, Status status);
    error StillHolding(uint256 balance, uint256 heldAtPost);

    // ============================================================ writes

    /**
     * @notice Review `token` (rating 1–5, up to 280 bytes of text) while holding some of it.
     *         If the caller already reviewed it, the new review replaces that one (which stays
     *         readable): allowed only `UPDATE_COOLDOWN` after the last one, and if the caller now
     *         holds less than half of what the last one recorded, that one is marked SOLD first.
     * @return id the new review's id
     */
    function post(address token, uint8 rating, string calldata text) external returns (uint256 id) {
        if (rating < 1 || rating > 5) revert InvalidRating(rating);
        if (bytes(text).length > MAX_TEXT_BYTES) revert TextTooLong(bytes(text).length);
        uint256 balance = _balanceOf(token, msg.sender);
        if (balance == 0) revert NotHolder(token);

        uint64 prev = _latest[msg.sender][token];
        if (prev != 0) {
            Review storage old = _reviews[prev];
            uint256 availableAt = uint256(old.postedAt) + UPDATE_COOLDOWN;
            if (block.timestamp < availableAt) revert TooSoon(availableAt);
            // an update can't wash away a sale: the old review is checked first
            if (old.status == Status.Active) {
                if (_sold(balance, old.heldAtPost)) _markSold(prev, old, balance);
                else old.status = Status.Replaced;
            }
        }

        uint64 newId = ++_count;
        _reviews[newId] = Review({
            author: msg.sender,
            rating: rating,
            status: Status.Active,
            postedAt: uint40(block.timestamp),
            soldAt: 0,
            token: token,
            previous: prev,
            heldAtPost: balance
        });
        _latest[msg.sender][token] = newId;
        emit ReviewPosted(newId, msg.sender, token, rating, balance, prev, text);
        return newId;
    }

    /**
     * @notice Mark review `id` SOLD if its author now holds less than half of what they held
     *         when posting. Anyone can call it; it reverts (and changes nothing) otherwise.
     */
    function markSold(uint256 id) external {
        Review storage r = _reviews[id];
        if (r.status == Status.None) revert UnknownReview(id);
        if (r.status != Status.Active) revert NotActive(id, r.status);
        uint256 balance = _balanceOf(r.token, r.author);
        if (!_sold(balance, r.heldAtPost)) revert StillHolding(balance, r.heldAtPost);
        _markSold(id, r, balance);
    }

    // ============================================================ views

    /// @notice How many reviews exist (ids are 1..reviewCount).
    function reviewCount() external view returns (uint256) {
        return _count;
    }

    /// @notice Review `id` (status None if it doesn't exist).
    function getReview(uint256 id) external view returns (Review memory) {
        return _reviews[id];
    }

    /// @notice `author`'s latest review of `token`: its id (0 = none) and the review.
    function reviewOf(address author, address token) external view returns (uint256 id, Review memory review) {
        id = _latest[author][token];
        review = _reviews[id];
    }

    /// @notice Whether `markSold(id)` would succeed right now.
    function canMarkSold(uint256 id) external view returns (bool) {
        Review storage r = _reviews[id];
        if (r.status != Status.Active) return false;
        (bool ok, uint256 balance) = _tryBalanceOf(r.token, r.author);
        return ok && _sold(balance, r.heldAtPost);
    }

    // ============================================================ internals

    /// @dev Below half of `held` (exactly half is still holding). No overflow for any uint256.
    function _sold(uint256 balance, uint256 held) private pure returns (bool) {
        return balance < held - held / 2;
    }

    function _markSold(uint256 id, Review storage r, uint256 balance) private {
        r.status = Status.Sold;
        r.soldAt = uint40(block.timestamp);
        emit ReviewSold(id, r.author, r.token, balance, r.heldAtPost);
    }

    function _balanceOf(address token, address who) private view returns (uint256) {
        (bool ok, uint256 balance) = _tryBalanceOf(token, who);
        if (!ok) revert NotAToken(token);
        return balance;
    }

    /// @dev balanceOf through STATICCALL; false for an address without code or a bad answer.
    function _tryBalanceOf(address token, address who) private view returns (bool, uint256) {
        if (token.code.length == 0) return (false, 0);
        (bool ok, bytes memory data) = token.staticcall(abi.encodeCall(IERC20.balanceOf, (who)));
        if (!ok || data.length < 32) return (false, 0);
        return (true, abi.decode(data, (uint256)));
    }
}
