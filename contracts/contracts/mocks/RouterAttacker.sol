// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {PrismForgeRouter} from "../PrismForgeRouter.sol";

/// A caller that tries to re-enter the router: when it receives the crystal NFT, or
/// when it receives the ETH refund. It can also refuse ETH outright.
contract RouterAttacker is IERC721Receiver {
    enum Mode { None, ReenterOnNFT, ReenterOnRefund, RejectEth }

    PrismForgeRouter public immutable router;
    Mode public mode;
    address public reenterToken;

    constructor(PrismForgeRouter router_) {
        router = router_;
    }

    function arm(Mode m, address token) external {
        mode = m;
        reenterToken = token;
    }

    function forge(PrismForgeRouter.Swap[] calldata swaps, uint256[] calldata mins, uint256 keep)
        external
        payable
        returns (uint256)
    {
        return router.forgeFromETH{value: msg.value}(swaps, mins, keep);
    }

    function _reenter() private {
        PrismForgeRouter.Swap[] memory s = new PrismForgeRouter.Swap[](1);
        s[0] = PrismForgeRouter.Swap({token: reenterToken, ethIn: 1});
        uint256[] memory m = new uint256[](1);
        m[0] = 1;
        router.forgeFromETH{value: 1}(s, m, 0); // must revert
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (mode == Mode.ReenterOnNFT) _reenter();
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        if (mode == Mode.RejectEth) revert("no ETH please");
        if (mode == Mode.ReenterOnRefund && msg.sender == address(router)) _reenter();
    }
}
