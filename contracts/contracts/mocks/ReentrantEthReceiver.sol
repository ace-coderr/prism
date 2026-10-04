// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ICrystalEth {
    function forge(address[] calldata tokens, uint256[] calldata amounts) external payable returns (uint256);
    function withdraw(uint256 id, address[] calldata tokens, uint256[] calldata amounts, uint256 ethAmount, address to) external;
}

/// Owns a crystal and tries to withdraw again from inside the ETH transfer callback.
contract ReentrantEthReceiver is IERC721Receiver {
    ICrystalEth public immutable crystal;
    uint256 public crystalId;
    bool public armed;

    constructor(address crystal_) {
        crystal = ICrystalEth(crystal_);
    }

    function forgeWithEth() external payable {
        crystalId = crystal.forge{value: msg.value}(new address[](0), new uint256[](0));
    }

    function attack(uint256 amount) external {
        armed = true;
        crystal.withdraw(crystalId, new address[](0), new uint256[](0), amount, address(this));
    }

    receive() external payable {
        if (armed) {
            armed = false;
            crystal.withdraw(crystalId, new address[](0), new uint256[](0), msg.value, address(this)); // must revert
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
