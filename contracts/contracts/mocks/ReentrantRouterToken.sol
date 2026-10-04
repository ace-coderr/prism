// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PrismForgeRouter} from "../PrismForgeRouter.sol";

/// An allowed-list token that turns hostile: when the PoolManager pays it out to the
/// router mid-swap, it tries to start another forge on the router.
contract ReentrantRouterToken is ERC20 {
    PrismForgeRouter public router;
    bool public armed;

    constructor() ERC20("Evil", "EVIL") {}

    function arm(PrismForgeRouter r) external payable {
        router = r;
        armed = true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && to == address(router)) {
            armed = false; // one shot
            PrismForgeRouter.Swap[] memory s = new PrismForgeRouter.Swap[](1);
            s[0] = PrismForgeRouter.Swap({token: address(this), ethIn: 1});
            uint256[] memory m = new uint256[](1);
            m[0] = 1;
            router.forgeFromETH{value: 1}(s, m, 0); // must revert
        }
    }

    receive() external payable {}
}
