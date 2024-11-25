// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract ERC20Token is ERC20, Ownable {
    uint8 private _customDecimals;
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        address initialOwner
    ) ERC20(name, symbol) {
        _customDecimals = decimals_;
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Mints `amount` tokens to the specified address `to`.
     * Can only be called by the owner.
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Returns the number of decimals for the token.
     */
    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }
}
