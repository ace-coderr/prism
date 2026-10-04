// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager, IUnlockCallback} from "../PrismForgeRouter.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// Test stand-in for the Uniswap V4 PoolManager: fixed prices per token, V4-style
/// flash accounting (everything owed inside `unlock` must be settled / taken before it
/// returns), and knobs for partial fills and rogue callbacks.
contract MockPoolManager {
    mapping(address token => uint256) public rate; // token units out per 1e18 wei in
    uint256 public fillBps = 10_000; // share of each exact-input amount actually swapped

    bool private _unlocked;
    address private _locker;
    uint256 private _ethOwed;
    uint256 private _ethPaid;
    mapping(address => uint256) private _owedOut;
    mapping(address => uint256) private _taken;
    address[] private _touched;

    function setRate(address token, uint256 r) external {
        rate[token] = r;
    }

    function setFillBps(uint256 bps) external {
        fillBps = bps;
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        require(!_unlocked, "AlreadyUnlocked");
        _unlocked = true;
        _locker = msg.sender;
        result = IUnlockCallback(msg.sender).unlockCallback(data);
        require(_ethPaid == _ethOwed, "CurrencyNotSettled(ETH)");
        for (uint256 i; i < _touched.length; ++i) {
            address t = _touched[i];
            require(_taken[t] == _owedOut[t], "CurrencyNotSettled(token)");
            delete _taken[t];
            delete _owedOut[t];
        }
        delete _touched;
        _ethOwed = 0;
        _ethPaid = 0;
        _unlocked = false;
    }

    function swap(IPoolManager.PoolKey memory key, IPoolManager.SwapParams memory p, bytes calldata)
        external
        returns (int256 delta)
    {
        require(_unlocked && msg.sender == _locker, "ManagerLocked");
        require(key.currency0 == address(0) && key.fee == 3000 && key.tickSpacing == 60 && key.hooks == address(0), "NoSuchPool");
        require(rate[key.currency1] > 0, "PoolNotInitialized");
        require(p.zeroForOne && p.amountSpecified < 0, "OnlyExactEthIn");
        uint256 used = (uint256(-p.amountSpecified) * fillBps) / 10_000;
        uint256 out = (used * rate[key.currency1]) / 1e18;
        _ethOwed += used;
        if (_owedOut[key.currency1] == 0) _touched.push(key.currency1);
        _owedOut[key.currency1] += out;
        int128 a0 = -int128(int256(used));
        int128 a1 = int128(int256(out));
        assembly {
            delta := or(shl(128, a0), and(sub(shl(128, 1), 1), a1))
        }
    }

    function settle() external payable returns (uint256) {
        require(_unlocked, "ManagerLocked");
        _ethPaid += msg.value;
        return msg.value;
    }

    function take(address currency, address to, uint256 amount) external {
        require(_unlocked && msg.sender == _locker, "ManagerLocked");
        _taken[currency] += amount;
        IMintable(currency).mint(to, amount);
    }

    /// Calls a contract's unlockCallback outside of any unlock (it must refuse).
    function poke(address target, bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(target).unlockCallback(data);
    }
}
