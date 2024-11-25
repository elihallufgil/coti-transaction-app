// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/token/PrivateERC20/PrivateERC20.sol";
import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PrivateERC20Token is PrivateERC20, Ownable {
uint8 private _customDecimals;

    /**
     * @dev Constructor to initialize the token with a custom name, symbol, decimals, and owner.
     * @param name The name of the token.
     * @param symbol The symbol of the token.
     * @param decimals_ The number of decimals for the token.
     * @param initialOwner The initial owner of the token contract.
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        address initialOwner
    ) PrivateERC20(name, symbol) {
        _customDecimals = decimals_;
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Mints `amount` tokens to the specified address `to`.
     * Can only be called by the owner.
     */
    function mint(address to, itUint64 calldata amount) public onlyOwner {
        gtUint64 gtAmount = MpcCore.validateCiphertext(amount);
        _mint(to, gtAmount);
    }

    /**
     * @dev Returns the number of decimals for the token.
     */
    function decimals() public view override returns (uint8) {
    return _customDecimals;
    }

    function burn(address account, uint64 amount) external {
        _burn(account, MpcCore.setPublic64(amount));
    }
}
