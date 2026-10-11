// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Minimal Uniswap V4 PoolManager surface (ABI-identical to v4-core: Currency and IHooks
/// encode as address, BalanceDelta as int256).
interface IV4PoolManager {
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
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

/**
 * TEST ONLY (fork tests; never deployed): buys a token with ETH, or sells it for ETH, through its
 * real ETH-paired Uniswap V4 pool, so a fork test can hold and then sell a real test stock.
 */
contract ForkV4Swapper {
    uint160 private constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    uint160 private constant MAX_SQRT_PRICE_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    IV4PoolManager public immutable POOL_MANAGER;

    constructor(IV4PoolManager poolManager) {
        POOL_MANAGER = poolManager;
    }

    /// Exact `msg.value` ETH in; the tokens go to the caller.
    function buy(address token, uint24 fee, int24 tickSpacing) external payable returns (uint256 out) {
        return abi.decode(POOL_MANAGER.unlock(abi.encode(true, token, fee, tickSpacing, msg.value, msg.sender)), (uint256));
    }

    /// Exact `amount` tokens in (approve this contract first); the ETH goes to the caller.
    function sell(address token, uint256 amount, uint24 fee, int24 tickSpacing) external returns (uint256 ethOut) {
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom");
        return abi.decode(POOL_MANAGER.unlock(abi.encode(false, token, fee, tickSpacing, amount, msg.sender)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), "pool manager only");
        (bool buying, address token, uint24 fee, int24 tickSpacing, uint256 amountIn, address to) =
            abi.decode(data, (bool, address, uint24, int24, uint256, address));
        IV4PoolManager.PoolKey memory key = IV4PoolManager.PoolKey(address(0), token, fee, tickSpacing, address(0));
        int256 delta = POOL_MANAGER.swap(
            key,
            IV4PoolManager.SwapParams(buying, -int256(amountIn), buying ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE),
            ""
        );
        int128 amount0 = int128(delta >> 128); // ETH
        int128 amount1 = int128(delta); // token
        if (buying) {
            POOL_MANAGER.settle{value: uint256(uint128(-amount0))}();
            POOL_MANAGER.take(token, to, uint256(uint128(amount1)));
            return abi.encode(uint256(uint128(amount1)));
        }
        POOL_MANAGER.sync(token);
        require(IERC20(token).transfer(address(POOL_MANAGER), uint256(uint128(-amount1))), "transfer");
        POOL_MANAGER.settle();
        POOL_MANAGER.take(address(0), to, uint256(uint128(amount0)));
        return abi.encode(uint256(uint128(amount0)));
    }
}
