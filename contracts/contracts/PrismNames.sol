// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PRISM Names
 * @notice On-chain usernames for PRISM: one name per address, one address per name,
 *         first come first served. Names are 3–20 characters of lowercase a–z, 0–9 and
 *         underscore. Setting a new name releases the old one; clearing frees it.
 *
 *         No owner, no admin, no fees, no upgrades: nobody can take, reserve or reassign
 *         a name. (The app refuses some impersonation-prone words before sending; the
 *         contract itself has no blocklist, see SECURITY.md.)
 */
contract PrismNames {
    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 20;

    mapping(address owner => string) private _nameOf;
    mapping(bytes32 nameHash => address) private _ownerOf;

    event NameSet(address indexed owner, string name);
    event NameCleared(address indexed owner, string name);

    error InvalidName();
    error NameTaken(address owner);
    error AlreadyYours();
    error NoName();

    /// @notice Claim `name` for the caller, releasing the caller's previous name (if any).
    function setName(string calldata name) external {
        if (!isValid(name)) revert InvalidName();
        bytes32 key = keccak256(bytes(name));
        address holder = _ownerOf[key];
        if (holder == msg.sender) revert AlreadyYours();
        if (holder != address(0)) revert NameTaken(holder);

        string memory old = _nameOf[msg.sender];
        if (bytes(old).length != 0) {
            delete _ownerOf[keccak256(bytes(old))];
            emit NameCleared(msg.sender, old);
        }
        _nameOf[msg.sender] = name;
        _ownerOf[key] = msg.sender;
        emit NameSet(msg.sender, name);
    }

    /// @notice Give up the caller's name, so anyone can claim it.
    function clearName() external {
        string memory old = _nameOf[msg.sender];
        if (bytes(old).length == 0) revert NoName();
        delete _ownerOf[keccak256(bytes(old))];
        delete _nameOf[msg.sender];
        emit NameCleared(msg.sender, old);
    }

    /// @notice The name `owner` holds, or "" when none.
    function nameOf(address owner) external view returns (string memory) {
        return _nameOf[owner];
    }

    /// @notice Who holds `name`, or address(0) when nobody does.
    function ownerOfName(string calldata name) external view returns (address) {
        return _ownerOf[keccak256(bytes(name))];
    }

    /// @notice 3–20 characters, each a–z, 0–9 or "_".
    function isValid(string calldata name) public pure returns (bool) {
        bytes calldata b = bytes(name);
        if (b.length < MIN_LENGTH || b.length > MAX_LENGTH) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) return false;
        }
        return true;
    }
}
