// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title PRISM Crystal
 * @notice An ERC-721 that holds its own basket of ERC-20 tokens and ETH.
 *         Whoever owns the NFT owns the basket: transferring the NFT moves the
 *         whole basket, and only the current owner can add to or withdraw from it.
 *
 *         There is no owner/admin role, no pause, no fees, no upgradeability and no
 *         rescue function. The contract only ever moves a crystal's assets when that
 *         crystal's current owner calls withdraw / withdrawAllAndBurn.
 */
contract PrismCrystal is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    /// Max distinct assets per crystal. ETH counts as one asset while its balance is > 0.
    uint256 public constant MAX_ASSETS = 8;
    /// Guards against fat-finger seals (e.g. a millisecond timestamp ≈ 55,000 years).
    uint256 public constant MAX_SEAL_DURATION = 100 * 365 days;

    uint256 private _nextId = 1;

    mapping(uint256 id => address[]) private _tokens;
    mapping(uint256 id => mapping(address token => uint256)) private _balance;
    mapping(uint256 id => mapping(address token => uint256)) private _indexPlusOne;
    mapping(uint256 id => uint256) private _ethBalance;
    mapping(uint256 id => uint64) private _sealedUntil;

    /// Sum of all crystals' recorded balances per token (for accounting checks).
    mapping(address token => uint256) public totalRecorded;
    /// Sum of all crystals' ETH balances.
    uint256 public totalEthRecorded;

    // ---------------------------------------------------------------- events
    event Forged(uint256 indexed id, address indexed owner, address[] tokens, uint256[] received, uint256 eth);
    event Added(uint256 indexed id, address indexed by, address[] tokens, uint256[] received, uint256 eth);
    event Withdrawn(uint256 indexed id, address indexed to, address[] tokens, uint256[] amounts, uint256 eth);
    event Sealed(uint256 indexed id, uint64 unlockTime);
    event Burned(uint256 indexed id, address indexed to, address[] tokens, uint256[] amounts, uint256 eth);

    // ---------------------------------------------------------------- errors
    error NotCrystalOwner();
    error CrystalSealed(uint64 unlockTime);
    error LengthMismatch();
    error EmptyDeposit();
    error NothingToWithdraw();
    error ZeroAmount();
    error ZeroAddress();
    error DuplicateToken(address token);
    error TooManyAssets();
    error NothingReceived(address token);
    error InsufficientBalance(address token, uint256 available, uint256 requested);
    error InsufficientEth(uint256 available, uint256 requested);
    error SealMustBeInFuture();
    error SealCanOnlyBeExtended(uint64 current);
    error SealTooLong();
    error EthTransferFailed();

    constructor() ERC721("PRISM Crystal", "PRISM") {}

    modifier onlyCrystalOwner(uint256 id) {
        // ownerOf reverts for nonexistent ids. Approved operators are NOT owners here:
        // they may transfer the NFT (standard ERC-721) but never touch its contents.
        if (ownerOf(id) != msg.sender) revert NotCrystalOwner();
        _;
    }

    modifier notSealed(uint256 id) {
        uint64 until = _sealedUntil[id];
        if (block.timestamp < until) revert CrystalSealed(until);
        _;
    }

    // ============================================================ deposits

    /// @notice Mint a new crystal to msg.sender holding `tokens` (pulled via transferFrom) plus any ETH sent.
    function forge(address[] calldata tokens, uint256[] calldata amounts)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        if (tokens.length == 0 && msg.value == 0) revert EmptyDeposit();
        id = _nextId++;
        uint256[] memory received = _deposit(id, tokens, amounts);
        _safeMint(msg.sender, id);
        emit Forged(id, msg.sender, tokens, received, msg.value);
    }

    /// @notice Add more tokens / ETH to a crystal you own. Topping up an asset it already holds is allowed.
    function addTo(uint256 id, address[] calldata tokens, uint256[] calldata amounts)
        external
        payable
        nonReentrant
        onlyCrystalOwner(id)
    {
        if (tokens.length == 0 && msg.value == 0) revert EmptyDeposit();
        uint256[] memory received = _deposit(id, tokens, amounts);
        emit Added(id, msg.sender, tokens, received, msg.value);
    }

    function _deposit(uint256 id, address[] calldata tokens, uint256[] calldata amounts)
        private
        returns (uint256[] memory received)
    {
        uint256 n = tokens.length;
        if (n != amounts.length) revert LengthMismatch();
        received = new uint256[](n);

        for (uint256 i; i < n; ++i) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            for (uint256 j; j < i; ++j) {
                if (tokens[j] == token) revert DuplicateToken(token);
            }

            // Record what actually arrived, so fee-on-transfer tokens can't inflate balances.
            uint256 before = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amounts[i]);
            uint256 got = IERC20(token).balanceOf(address(this)) - before;
            if (got == 0) revert NothingReceived(token);

            if (_indexPlusOne[id][token] == 0) {
                _tokens[id].push(token);
                _indexPlusOne[id][token] = _tokens[id].length;
            }
            _balance[id][token] += got;
            totalRecorded[token] += got;
            received[i] = got;
        }

        if (msg.value > 0) {
            _ethBalance[id] += msg.value;
            totalEthRecorded += msg.value;
        }

        if (_assetCount(id) > MAX_ASSETS) revert TooManyAssets();
    }

    // ============================================================ withdrawals

    /// @notice Withdraw part of a crystal's contents. Owner only; blocked while sealed.
    function withdraw(
        uint256 id,
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256 ethAmount,
        address to
    ) external nonReentrant onlyCrystalOwner(id) notSealed(id) {
        if (to == address(0)) revert ZeroAddress();
        if (tokens.length != amounts.length) revert LengthMismatch();
        if (tokens.length == 0 && ethAmount == 0) revert NothingToWithdraw();

        // effects first
        _debitTokens(id, tokens, amounts);
        _debitEth(id, ethAmount);

        // then interactions
        for (uint256 i; i < tokens.length; ++i) {
            IERC20(tokens[i]).safeTransfer(to, amounts[i]);
        }
        if (ethAmount > 0) _sendEth(to, ethAmount);

        emit Withdrawn(id, to, tokens, amounts, ethAmount);
    }

    function _debitTokens(uint256 id, address[] calldata tokens, uint256[] calldata amounts) private {
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            uint256 amount = amounts[i];
            if (amount == 0) revert ZeroAmount();
            uint256 bal = _balance[id][token];
            if (amount > bal) revert InsufficientBalance(token, bal, amount);
            _balance[id][token] = bal - amount;
            totalRecorded[token] -= amount;
            if (bal == amount) _removeToken(id, token);
        }
    }

    function _debitEth(uint256 id, uint256 ethAmount) private {
        if (ethAmount == 0) return;
        uint256 ethBal = _ethBalance[id];
        if (ethAmount > ethBal) revert InsufficientEth(ethBal, ethAmount);
        _ethBalance[id] = ethBal - ethAmount;
        totalEthRecorded -= ethAmount;
    }

    /// @notice Empty the crystal to `to` and burn the NFT. Owner only; blocked while sealed.
    function withdrawAllAndBurn(uint256 id, address to) external nonReentrant onlyCrystalOwner(id) notSealed(id) {
        if (to == address(0)) revert ZeroAddress();

        address[] memory tokens = _tokens[id];
        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            uint256 bal = _balance[id][token];
            amounts[i] = bal;
            totalRecorded[token] -= bal;
            delete _balance[id][token];
            delete _indexPlusOne[id][token];
        }
        delete _tokens[id];
        uint256 eth = _ethBalance[id];
        totalEthRecorded -= eth;
        delete _ethBalance[id];
        delete _sealedUntil[id];

        _burn(id);

        for (uint256 i; i < tokens.length; ++i) {
            IERC20(tokens[i]).safeTransfer(to, amounts[i]);
        }
        if (eth > 0) _sendEth(to, eth);

        emit Burned(id, to, tokens, amounts, eth);
    }

    // ============================================================ sealing (gifts)

    /// @notice Seal a crystal until `unlockTime`. Can be set or extended, never shortened.
    ///         While sealed nothing can be withdrawn, but the NFT can still be transferred.
    function seal(uint256 id, uint64 unlockTime) external onlyCrystalOwner(id) {
        if (unlockTime <= block.timestamp) revert SealMustBeInFuture();
        uint64 current = _sealedUntil[id];
        if (unlockTime <= current) revert SealCanOnlyBeExtended(current);
        if (unlockTime > block.timestamp + MAX_SEAL_DURATION) revert SealTooLong();
        _sealedUntil[id] = unlockTime;
        emit Sealed(id, unlockTime);
    }

    function sealedUntil(uint256 id) external view returns (uint64) {
        _requireOwned(id);
        return _sealedUntil[id];
    }

    function isSealed(uint256 id) public view returns (bool) {
        _requireOwned(id);
        return block.timestamp < _sealedUntil[id];
    }

    // ============================================================ views

    /// @notice A crystal's contents: ERC-20 tokens with their balances, plus its ETH balance.
    function holdings(uint256 id)
        external
        view
        returns (address[] memory tokens, uint256[] memory balances, uint256 eth)
    {
        _requireOwned(id);
        tokens = _tokens[id];
        balances = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            balances[i] = _balance[id][tokens[i]];
        }
        eth = _ethBalance[id];
    }

    /// @notice Fully on-chain metadata: base64 JSON with holdings as attributes and an SVG image.
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        bool sealedNow = block.timestamp < _sealedUntil[id];
        string memory json = string.concat(
            '{"name":"PRISM Crystal #',
            id.toString(),
            '","description":"A PRISM crystal: an NFT that holds its own basket of tokens. Whoever owns it owns the basket.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(id, sealedNow))),
            '","attributes":',
            _attributes(id, sealedNow),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ============================================================ internals

    function _assetCount(uint256 id) private view returns (uint256) {
        return _tokens[id].length + (_ethBalance[id] > 0 ? 1 : 0);
    }

    function _removeToken(uint256 id, address token) private {
        uint256 idx = _indexPlusOne[id][token] - 1;
        address[] storage list = _tokens[id];
        uint256 last = list.length - 1;
        if (idx != last) {
            address moved = list[last];
            list[idx] = moved;
            _indexPlusOne[id][moved] = idx + 1;
        }
        list.pop();
        delete _indexPlusOne[id][token];
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    function _attributes(uint256 id, bool sealedNow) private view returns (string memory out) {
        address[] memory tokens = _tokens[id];
        out = string.concat('[{"trait_type":"Assets","value":', _assetCount(id).toString(), "}");
        if (_ethBalance[id] > 0) {
            out = string.concat(out, ',{"trait_type":"ETH","value":"', _formatUnits(_ethBalance[id], 18), '"}');
        }
        for (uint256 i; i < tokens.length; ++i) {
            out = string.concat(
                out,
                ',{"trait_type":"',
                _safeSymbol(tokens[i]),
                '","value":"',
                _formatUnits(_balance[id][tokens[i]], _safeDecimals(tokens[i])),
                '"}'
            );
        }
        out = string.concat(out, ',{"trait_type":"Sealed","value":"', sealedNow ? "Yes" : "No", '"}');
        if (sealedNow) {
            out = string.concat(
                out,
                ',{"trait_type":"Unlocks","display_type":"date","value":',
                uint256(_sealedUntil[id]).toString(),
                "}"
            );
        }
        out = string.concat(out, "]");
    }

    // Voxel gem in the PRISM palette (lime crown, gold heart, olive pavilion), 24px cubes.
    string private constant GEM =
        "<g stroke='#000' stroke-width='3'>"
        "<rect x='84' y='24' width='24' height='24' fill='#e6ff5c'/><rect x='108' y='24' width='24' height='24' fill='#e6ff5c'/><rect x='132' y='24' width='24' height='24' fill='#e6ff5c'/>"
        "<rect x='60' y='48' width='24' height='24' fill='#e6ff5c'/><rect x='84' y='48' width='24' height='24' fill='#d4f000'/><rect x='108' y='48' width='24' height='24' fill='#d4f000'/><rect x='132' y='48' width='24' height='24' fill='#d4f000'/><rect x='156' y='48' width='24' height='24' fill='#e6ff5c'/>"
        "<rect x='36' y='72' width='24' height='24' fill='#e6ff5c'/><rect x='60' y='72' width='24' height='24' fill='#d4f000'/><rect x='84' y='72' width='24' height='24' fill='#d4f000'/><rect x='108' y='72' width='24' height='24' fill='#f6c143'/><rect x='132' y='72' width='24' height='24' fill='#d4f000'/><rect x='156' y='72' width='24' height='24' fill='#d4f000'/><rect x='180' y='72' width='24' height='24' fill='#e6ff5c'/>"
        "<rect x='60' y='96' width='24' height='24' fill='#8fa300'/><rect x='84' y='96' width='24' height='24' fill='#8fa300'/><rect x='108' y='96' width='24' height='24' fill='#8fa300'/><rect x='132' y='96' width='24' height='24' fill='#8fa300'/><rect x='156' y='96' width='24' height='24' fill='#8fa300'/>"
        "<rect x='84' y='120' width='24' height='24' fill='#8fa300'/><rect x='108' y='120' width='24' height='24' fill='#8fa300'/><rect x='132' y='120' width='24' height='24' fill='#8fa300'/>"
        "<rect x='108' y='144' width='24' height='24' fill='#8fa300'/>"
        "</g>";

    function _svg(uint256 id, bool sealedNow) private view returns (string memory svg) {
        // one small cube per asset under the gem
        uint256 n = _assetCount(id);
        string memory dots;
        uint256 x0 = 120 - (n * 20) / 2 + 3;
        for (uint256 i; i < n; ++i) {
            dots = string.concat(
                dots,
                "<rect x='",
                (x0 + i * 20).toString(),
                "' y='182' width='14' height='14' fill='#d4f000' stroke='#000' stroke-width='2'/>"
            );
        }
        svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240' shape-rendering='crispEdges'>",
            "<rect width='240' height='240' fill='#101214'/>",
            "<ellipse cx='120' cy='172' rx='70' ry='10' fill='#d4f000' opacity='0.12'/>",
            GEM,
            dots,
            "<text x='120' y='224' fill='#d4f000' font-family='monospace' font-size='14' font-weight='bold' text-anchor='middle' letter-spacing='2'>PRISM #",
            id.toString(),
            "</text>"
        );
        if (sealedNow) {
            // frost wrap for sealed gifts
            svg = string.concat(
                svg,
                "<rect width='240' height='240' fill='#bfe6ff' opacity='0.28'/>",
                "<text x='120' y='16' fill='#ffffff' font-family='monospace' font-size='11' text-anchor='middle' letter-spacing='3'>SEALED</text>"
            );
        }
        svg = string.concat(svg, "</svg>");
    }

    /// ERC-20 symbol made JSON-safe: [A-Za-z0-9._-] only, max 12 chars; falls back to "TOKEN".
    function _safeSymbol(address token) private view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory s) {
            bytes memory b = bytes(s);
            uint256 len = b.length > 12 ? 12 : b.length;
            if (len == 0) return "TOKEN";
            bytes memory out = new bytes(len);
            for (uint256 i; i < len; ++i) {
                bytes1 c = b[i];
                bool ok = (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c == "." || c == "-" || c == "_";
                out[i] = ok ? c : bytes1("_");
            }
            return string(out);
        } catch {
            return "TOKEN";
        }
    }

    function _safeDecimals(address token) private view returns (uint8) {
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            return d > 36 ? 18 : d;
        } catch {
            return 18;
        }
    }

    /// "1234.5678" — integer part plus up to 4 decimals, trailing zeros trimmed.
    function _formatUnits(uint256 amount, uint8 decimals) private pure returns (string memory) {
        uint256 unit = 10 ** decimals;
        uint256 whole = amount / unit;
        uint256 frac = decimals >= 4 ? (amount % unit) / 10 ** (decimals - 4) : (amount % unit) * 10 ** (4 - decimals);
        if (frac == 0) return whole.toString();
        bytes memory f = bytes(frac.toString());
        // left-pad to 4 digits
        bytes memory padded = new bytes(4);
        uint256 pad = 4 - f.length;
        for (uint256 i; i < 4; ++i) padded[i] = i < pad ? bytes1("0") : f[i - pad];
        uint256 end = 4;
        while (end > 0 && padded[end - 1] == "0") --end;
        bytes memory trimmed = new bytes(end);
        for (uint256 i; i < end; ++i) trimmed[i] = padded[i];
        return string.concat(whole.toString(), ".", string(trimmed));
    }
}
