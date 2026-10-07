// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PRISM Gift Links
 * @notice Send a PrismCrystal as a link, to someone who may not have a wallet yet.
 *
 *         The sender's browser makes a fresh one-time keypair, the "claim key". The sender
 *         deposits a crystal here with `safeTransferFrom(sender, this, id, data)`, where `data`
 *         is `abi.encode(address claimKey, uint64 expiry, string note)`; that one transaction
 *         creates the link. Only the claim key's ADDRESS is stored. The private key travels in
 *         the link's URL fragment (#k=…), which browsers never send to a server.
 *
 *         Whoever holds the link can `claim(linkId, recipient)`: the call must come from the
 *         claim key itself (msg.sender), before the expiry, and sends the crystal to any
 *         recipient they choose. Because the claim key is the sender of the transaction, nobody
 *         watching the mempool can redirect a claim without the key.
 *
 *         The original sender can `cancel` an unclaimed link at any time (also after it
 *         expired) and gets the crystal back. A sealed crystal can be linked: the seal travels
 *         with it, as with any transfer.
 *
 *         No owner, no admin, no fees, no pause, no upgrades, and no other way out for a
 *         crystal: only claim (to the recipient) or cancel (to the sender).
 */
contract PrismGiftLinks is IERC721Receiver, ReentrancyGuard {
    enum Status {
        None,
        Open,
        Claimed,
        Cancelled,
        Expired // only reported by statusOf: an open link past its expiry
    }

    struct Link {
        address sender; // who deposited the crystal (its owner at the time); can cancel
        uint64 expiry; // claimable while block.timestamp < expiry
        Status status; // Open, Claimed or Cancelled (stored)
        address claimKey; // the only address allowed to claim
        address claimedBy; // the recipient, once claimed
        uint256 crystalId;
    }

    /// Links last at most a year (guards against typos such as a millisecond timestamp).
    uint256 public constant MAX_LINK_DURATION = 365 days;
    /// Room for 140 characters of any script or emoji (up to 4 bytes each in UTF-8).
    uint256 public constant MAX_NOTE_BYTES = 560;

    /// @notice The PrismCrystal collection (fixed at deploy).
    IERC721 public immutable CRYSTAL;

    /// @notice Links are numbered from 1.
    uint256 public linkCount;
    mapping(uint256 linkId => Link) private _links;

    event LinkCreated(
        uint256 indexed linkId,
        address indexed sender,
        uint256 indexed crystalId,
        address claimKey,
        uint64 expiry,
        string note
    );
    event LinkClaimed(uint256 indexed linkId, address indexed recipient, uint256 indexed crystalId);
    event LinkCancelled(uint256 indexed linkId, address indexed sender, uint256 indexed crystalId);

    error ZeroAddress();
    error NotCrystal();
    error NoLinkData();
    error BadClaimKey();
    error BadExpiry();
    error NoteTooLong();
    error NotOpen(uint256 linkId, Status status);
    error NotClaimKey();
    error LinkExpired(uint64 expiry);
    error BadRecipient();
    error NotSender();

    constructor(IERC721 crystal) {
        if (address(crystal) == address(0)) revert ZeroAddress();
        CRYSTAL = crystal;
    }

    /**
     * @notice Creates a link when a crystal arrives with `safeTransferFrom(from, this, id, data)`.
     *         Anything else is refused: another collection, or a transfer without link data.
     * @dev    A plain `transferFrom` to this contract skips this hook and the crystal could never
     *         leave (there is no admin to rescue it). The app only ever uses `safeTransferFrom`.
     */
    function onERC721Received(address, address from, uint256 crystalId, bytes calldata data)
        external
        nonReentrant
        returns (bytes4)
    {
        if (msg.sender != address(CRYSTAL)) revert NotCrystal();
        if (from == address(0)) revert ZeroAddress();
        if (data.length == 0) revert NoLinkData();
        (address claimKey, uint64 expiry, string memory note) = abi.decode(data, (address, uint64, string));
        if (claimKey == address(0) || claimKey == address(this)) revert BadClaimKey();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_LINK_DURATION) revert BadExpiry();
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();

        uint256 linkId = ++linkCount;
        _links[linkId] = Link({
            sender: from,
            expiry: expiry,
            status: Status.Open,
            claimKey: claimKey,
            claimedBy: address(0),
            crystalId: crystalId
        });
        emit LinkCreated(linkId, from, crystalId, claimKey, expiry, note);
        return IERC721Receiver.onERC721Received.selector;
    }

    /**
     * @notice Claim a link's crystal for `recipient`. Must be sent by the link's claim key,
     *         before the expiry. One claim per link.
     */
    function claim(uint256 linkId, address recipient) external nonReentrant {
        Link storage link = _links[linkId];
        if (link.status != Status.Open) revert NotOpen(linkId, link.status);
        if (msg.sender != link.claimKey) revert NotClaimKey();
        if (block.timestamp >= link.expiry) revert LinkExpired(link.expiry);
        if (recipient == address(0) || recipient == address(this)) revert BadRecipient();

        link.status = Status.Claimed;
        link.claimedBy = recipient;
        uint256 crystalId = link.crystalId;
        emit LinkClaimed(linkId, recipient, crystalId);
        CRYSTAL.safeTransferFrom(address(this), recipient, crystalId);
    }

    /// @notice The sender takes an unclaimed crystal back: any time, also after the expiry.
    function cancel(uint256 linkId) external nonReentrant {
        Link storage link = _links[linkId];
        if (link.status != Status.Open) revert NotOpen(linkId, link.status);
        if (msg.sender != link.sender) revert NotSender();

        link.status = Status.Cancelled;
        uint256 crystalId = link.crystalId;
        emit LinkCancelled(linkId, msg.sender, crystalId);
        CRYSTAL.safeTransferFrom(address(this), msg.sender, crystalId);
    }

    /// @notice A link as stored (`status` is Open, Claimed or Cancelled; see statusOf for Expired).
    function getLink(uint256 linkId) external view returns (Link memory) {
        return _links[linkId];
    }

    /// @notice None, Open, Claimed, Cancelled, or Expired (open but past its expiry: only cancel works).
    function statusOf(uint256 linkId) external view returns (Status) {
        Link storage link = _links[linkId];
        if (link.status == Status.Open && block.timestamp >= link.expiry) return Status.Expired;
        return link.status;
    }
}
