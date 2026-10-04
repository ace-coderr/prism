// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IPrismCrystal {
    function forge(address[] calldata tokens, uint256[] calldata amounts) external payable returns (uint256);
    function withdraw(uint256 id, address[] calldata tokens, uint256[] calldata amounts, uint256 ethAmount, address to) external;
}

/// Malicious ERC-20 that owns a crystal holding itself and tries to re-enter the
/// crystal contract from inside its own transfer (during withdraw or deposit).
contract ReentrantToken is ERC20, IERC721Receiver {
    enum Mode { None, ReenterWithdraw, ReenterForge }

    IPrismCrystal public immutable crystal;
    Mode public mode;
    uint256 public crystalId;

    constructor(address crystal_) ERC20("Evil", "EVIL") {
        crystal = IPrismCrystal(crystal_);
    }

    function forgeSelf(uint256 amount) external returns (uint256 id) {
        _mint(address(this), amount);
        _approve(address(this), address(crystal), amount);
        (address[] memory t, uint256[] memory a) = _one(amount);
        id = crystal.forge(t, a);
        crystalId = id;
    }

    function arm(Mode m) external {
        mode = m;
    }

    function withdrawSelf(uint256 amount) external {
        (address[] memory t, uint256[] memory a) = _one(amount);
        crystal.withdraw(crystalId, t, a, 0, address(this));
    }

    function forgeSelfArmed(uint256 amount) external {
        _mint(address(this), amount);
        _approve(address(this), address(crystal), amount);
        (address[] memory t, uint256[] memory a) = _one(amount);
        crystal.forge(t, a);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        Mode m = mode;
        if (m == Mode.ReenterWithdraw && from == address(crystal)) {
            mode = Mode.None; // one shot
            (address[] memory t, uint256[] memory a) = _one(1);
            crystal.withdraw(crystalId, t, a, 0, address(this)); // must revert
        } else if (m == Mode.ReenterForge && to == address(crystal)) {
            mode = Mode.None; // one shot
            (address[] memory t, uint256[] memory a) = _one(1);
            crystal.forge(t, a); // must revert
        }
    }

    function _one(uint256 amount) private view returns (address[] memory t, uint256[] memory a) {
        t = new address[](1);
        a = new uint256[](1);
        t[0] = address(this);
        a[0] = amount;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
