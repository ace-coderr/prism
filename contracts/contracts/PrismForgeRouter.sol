// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// Minimal Uniswap V4 PoolManager surface the router uses (ABI-identical to v4-core:
/// Currency and IHooks encode as address, BalanceDelta as int256).
interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 swapDelta);
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

interface IPrismCrystal {
    function forge(address[] calldata tokens, uint256[] calldata amounts) external payable returns (uint256 id);
}

/**
 * @title PRISM Forge Router
 * @notice Forge a crystal from ETH in one transaction: swap ETH into the chosen test
 *         stocks through their Uniswap V4 pools (ETH-paired, no hooks), check every output
 *         against the caller's minimum, forge a PrismCrystal holding exactly those outputs
 *         (plus any ETH the caller keeps as ETH) and hand the NFT to the caller.
 *
 *         Stateless and admin-free: no owner, no fees, no pause, no upgrades, no storage.
 *         The allowed tokens and pool settings are fixed at deploy (immutables), so the
 *         router can't be pointed at arbitrary contracts. Every call ends with the router
 *         holding no tokens and no ETH: leftovers go back to the caller, then it checks.
 */
contract PrismForgeRouter is IUnlockCallback, IERC721Receiver, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Swap {
        address token;
        uint256 ethIn;
    }

    /// TickMath.MIN_SQRT_PRICE + 1: no price limit for an ETH → token (zeroForOne) swap.
    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    /// At most this many tokens can be allowed (one immutable slot each).
    uint256 public constant MAX_TOKENS = 5;

    IPoolManager public immutable POOL_MANAGER;
    address public immutable CRYSTAL;
    /// Pool settings shared by every allowed token's ETH pool (hooks are always none).
    uint24 public immutable FEE;
    int24 public immutable TICK_SPACING;

    address public immutable TOKEN_0;
    address public immutable TOKEN_1;
    address public immutable TOKEN_2;
    address public immutable TOKEN_3;
    address public immutable TOKEN_4;

    event ForgedFromETH(
        uint256 indexed id,
        address indexed owner,
        address[] tokens,
        uint256[] amountsOut,
        uint256 ethSwapped,
        uint256 ethKept,
        uint256 ethRefunded
    );

    error ZeroAddress();
    error BadTokenList();
    error BadSwapCount();
    error LengthMismatch();
    error UnknownToken(address token);
    error DuplicateToken(address token);
    error ZeroAmount();
    error ZeroMinimum(address token);
    error NotEnoughEth(uint256 sent, uint256 needed);
    error InsufficientOutput(address token, uint256 got, uint256 minimum);
    error UnexpectedDelta();
    error NotPoolManager();
    error NotForging();
    error UnexpectedNFT();
    error RefundFailed();
    error NotEmpty();
    error NotDelivered();

    constructor(IPoolManager poolManager, address crystal, address[] memory tokens, uint24 fee, int24 tickSpacing) {
        if (address(poolManager) == address(0) || crystal == address(0)) revert ZeroAddress();
        uint256 n = tokens.length;
        if (n == 0 || n > MAX_TOKENS) revert BadTokenList();
        for (uint256 i; i < n; ++i) {
            if (tokens[i] == address(0)) revert BadTokenList();
            for (uint256 j; j < i; ++j) if (tokens[j] == tokens[i]) revert BadTokenList();
        }
        POOL_MANAGER = poolManager;
        CRYSTAL = crystal;
        FEE = fee;
        TICK_SPACING = tickSpacing;
        TOKEN_0 = tokens[0];
        TOKEN_1 = n > 1 ? tokens[1] : address(0);
        TOKEN_2 = n > 2 ? tokens[2] : address(0);
        TOKEN_3 = n > 3 ? tokens[3] : address(0);
        TOKEN_4 = n > 4 ? tokens[4] : address(0);
    }

    /// @notice True for the test-stock tokens this router was deployed with.
    function isAllowed(address token) public view returns (bool) {
        return token != address(0)
            && (token == TOKEN_0 || token == TOKEN_1 || token == TOKEN_2 || token == TOKEN_3 || token == TOKEN_4);
    }

    /// @notice The tokens this router accepts, in deploy order.
    function allowedTokens() external view returns (address[] memory tokens) {
        address[5] memory all = [TOKEN_0, TOKEN_1, TOKEN_2, TOKEN_3, TOKEN_4];
        uint256 n;
        for (uint256 i; i < MAX_TOKENS; ++i) if (all[i] != address(0)) ++n;
        tokens = new address[](n);
        for (uint256 i; i < n; ++i) tokens[i] = all[i];
    }

    /**
     * @notice Swap ETH into each chosen token and forge a crystal holding the results,
     *         plus `ethToKeep` as ETH. The crystal goes to the caller.
     * @param swaps          token + how much ETH to swap into it (one entry per token)
     * @param minAmountsOut  the least of each token the caller accepts (reverts below it)
     * @param ethToKeep      ETH to put in the crystal as ETH
     * @dev msg.value must cover every ethIn plus ethToKeep; anything unspent is refunded.
     */
    function forgeFromETH(Swap[] calldata swaps, uint256[] calldata minAmountsOut, uint256 ethToKeep)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        uint256 n = swaps.length;
        if (n == 0 || n > MAX_TOKENS) revert BadSwapCount();
        if (minAmountsOut.length != n) revert LengthMismatch();

        address[] memory tokens = new address[](n);
        uint256 ethForSwaps;
        for (uint256 i; i < n; ++i) {
            address token = swaps[i].token;
            if (!isAllowed(token)) revert UnknownToken(token);
            for (uint256 j; j < i; ++j) if (tokens[j] == token) revert DuplicateToken(token);
            if (swaps[i].ethIn == 0) revert ZeroAmount();
            if (minAmountsOut[i] == 0) revert ZeroMinimum(token);
            tokens[i] = token;
            ethForSwaps += swaps[i].ethIn;
        }
        if (ethForSwaps + ethToKeep > msg.value) revert NotEnoughEth(msg.value, ethForSwaps + ethToKeep);

        // 1. swaps (inside the PoolManager's unlock; see unlockCallback)
        (uint256[] memory amountsOut, uint256 ethSwapped) =
            abi.decode(POOL_MANAGER.unlock(abi.encode(swaps)), (uint256[], uint256));

        // 2. slippage: every output must meet its minimum, or nothing happens
        for (uint256 i; i < n; ++i) {
            if (amountsOut[i] < minAmountsOut[i]) revert InsufficientOutput(tokens[i], amountsOut[i], minAmountsOut[i]);
            IERC20(tokens[i]).forceApprove(CRYSTAL, amountsOut[i]);
        }

        // 3. forge (the crystal mints to this router, see onERC721Received) and hand it over
        id = IPrismCrystal(CRYSTAL).forge{value: ethToKeep}(tokens, amountsOut);
        IERC721(CRYSTAL).safeTransferFrom(address(this), msg.sender, id);
        if (IERC721(CRYSTAL).ownerOf(id) != msg.sender) revert NotDelivered();

        // 4. leftovers back to the caller (unspent ETH, any token dust), then prove we hold nothing
        for (uint256 i; i < n; ++i) {
            IERC20 t = IERC20(tokens[i]);
            uint256 left = t.balanceOf(address(this));
            if (left > 0) t.safeTransfer(msg.sender, left);
            if (t.allowance(address(this), CRYSTAL) != 0) t.forceApprove(CRYSTAL, 0);
        }
        uint256 refund = address(this).balance;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
        if (address(this).balance != 0) revert NotEmpty();
        for (uint256 i; i < n; ++i) if (IERC20(tokens[i]).balanceOf(address(this)) != 0) revert NotEmpty();

        emit ForgedFromETH(id, msg.sender, tokens, amountsOut, ethSwapped, ethToKeep, refund);
    }

    /**
     * @notice Called by the PoolManager inside `unlock`, only while forgeFromETH runs.
     *         Swaps exact ETH in for each token, pays the ETH owed and takes the tokens.
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager();
        if (!_reentrancyGuardEntered()) revert NotForging();

        Swap[] memory swaps = abi.decode(data, (Swap[]));
        uint256 n = swaps.length;
        uint256[] memory amountsOut = new uint256[](n);
        uint256 ethOwed;
        for (uint256 i; i < n; ++i) {
            IPoolManager.PoolKey memory key = IPoolManager.PoolKey({
                currency0: address(0), // native ETH sorts first in every ETH pair
                currency1: swaps[i].token,
                fee: FEE,
                tickSpacing: TICK_SPACING,
                hooks: address(0)
            });
            int256 delta = POOL_MANAGER.swap(
                key,
                IPoolManager.SwapParams({
                    zeroForOne: true,
                    amountSpecified: -int256(swaps[i].ethIn), // negative = exact input
                    sqrtPriceLimitX96: MIN_SQRT_PRICE_PLUS_ONE
                }),
                ""
            );
            int128 eth = int128(delta >> 128); // amount0: what we owe (negative)
            int128 out = int128(delta); // amount1: what we receive (positive)
            if (eth > 0 || out < 0) revert UnexpectedDelta();
            ethOwed += uint256(uint128(-eth));
            amountsOut[i] = uint256(uint128(out));
        }
        POOL_MANAGER.settle{value: ethOwed}();
        for (uint256 i; i < n; ++i) {
            if (amountsOut[i] > 0) POOL_MANAGER.take(swaps[i].token, address(this), amountsOut[i]);
        }
        return abi.encode(amountsOut, ethOwed);
    }

    /// @notice Accepts only the crystal this router is minting right now; anything else reverts.
    function onERC721Received(address operator, address from, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != CRYSTAL || operator != address(this) || from != address(0) || !_reentrancyGuardEntered()) {
            revert UnexpectedNFT();
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
