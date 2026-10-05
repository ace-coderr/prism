// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";

/**
 * @title PRISM Profiles
 * @notice Optional public profiles for PRISM, one per address:
 *         - a username: 3–20 characters of a–z, 0–9 and _, unique, first come first served;
 *           setting a new one releases the old one;
 *         - an avatar: one of your PrismCrystal NFTs. You must own it to set it, and it only
 *           counts while you still own it (a sold, gifted or burned crystal stops being your avatar);
 *         - a bio: up to 120 bytes of text, no control characters;
 *         - an X handle: 1–15 characters of a–z, A–Z, 0–9 and _ (a handle, not a link; unverified).
 *
 *         No owner, no admin, no fees, no upgrades: only an address can change its own profile,
 *         and nobody can take, reserve or reassign a name. `multicall` (OpenZeppelin) lets the app
 *         save several changes, including clears, in one transaction. The app refuses some words
 *         in names and bios before sending; the contract itself has no blocklist (see SECURITY.md).
 */
contract PrismProfiles is Multicall {
    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant MAX_NAME_LENGTH = 20;
    uint256 public constant MAX_BIO_LENGTH = 120;
    uint256 public constant MAX_X_LENGTH = 15;

    /// @notice The PrismCrystal collection avatars come from (fixed at deploy).
    IERC721 public immutable CRYSTAL;

    struct Profile {
        string name;
        uint256 avatarId; // 0 = none
        string bio;
        string x;
    }

    mapping(address owner => Profile) private _profiles;
    mapping(bytes32 nameHash => address) private _addressOfName;

    event NameSet(address indexed owner, string name);
    event NameCleared(address indexed owner, string name);
    event AvatarSet(address indexed owner, uint256 indexed crystalId);
    event AvatarCleared(address indexed owner);
    event BioSet(address indexed owner, string bio);
    event BioCleared(address indexed owner);
    event XSet(address indexed owner, string handle);
    event XCleared(address indexed owner);

    error ZeroAddress();
    error InvalidName();
    error NameTaken(address owner);
    error AlreadyYours();
    error NoName();
    error NotCrystalOwner(uint256 crystalId);
    error NoAvatar();
    error InvalidBio();
    error NoBio();
    error InvalidX();
    error NoX();

    constructor(address crystal) {
        if (crystal == address(0)) revert ZeroAddress();
        CRYSTAL = IERC721(crystal);
    }

    // ============================================================ name

    /// @notice Claim `name` for the caller, releasing the caller's previous name (if any).
    function setName(string calldata name) external {
        _setName(name, true);
    }

    /// @notice Give up the caller's name, so anyone can claim it.
    function clearName() external {
        string memory old = _profiles[msg.sender].name;
        if (bytes(old).length == 0) revert NoName();
        _releaseName(old);
    }

    // ============================================================ avatar

    /// @notice Use one of the caller's crystals as their avatar. The caller must own it now.
    function setAvatar(uint256 crystalId) external {
        _setAvatar(crystalId);
    }

    function clearAvatar() external {
        if (_profiles[msg.sender].avatarId == 0) revert NoAvatar();
        delete _profiles[msg.sender].avatarId;
        emit AvatarCleared(msg.sender);
    }

    // ============================================================ bio

    /// @notice Set a bio: 1–120 bytes, no control characters (use clearBio to remove it).
    function setBio(string calldata bio) external {
        _setBio(bio);
    }

    function clearBio() external {
        if (bytes(_profiles[msg.sender].bio).length == 0) revert NoBio();
        delete _profiles[msg.sender].bio;
        emit BioCleared(msg.sender);
    }

    // ============================================================ X handle

    /// @notice Set an X handle (without "@"): 1–15 characters of a–z, A–Z, 0–9 and _. Unverified.
    function setX(string calldata handle) external {
        _setX(handle);
    }

    function clearX() external {
        if (bytes(_profiles[msg.sender].x).length == 0) revert NoX();
        delete _profiles[msg.sender].x;
        emit XCleared(msg.sender);
    }

    // ============================================================ all at once

    /**
     * @notice Update several fields in one transaction. Empty values (and avatarId 0) leave that
     *         field unchanged; use the clear functions (or multicall) to remove one. Passing the
     *         caller's current name is a no-op. Reverts as a whole if any value is invalid.
     */
    function setProfile(string calldata name, uint256 avatarId, string calldata bio, string calldata x) external {
        if (bytes(name).length != 0) _setName(name, false);
        if (avatarId != 0) _setAvatar(avatarId);
        if (bytes(bio).length != 0) _setBio(bio);
        if (bytes(x).length != 0) _setX(x);
    }

    // ============================================================ views

    /// @notice `owner`'s profile; avatarId is 0 unless they still own that crystal.
    function profileOf(address owner) external view returns (Profile memory p) {
        p = _profiles[owner];
        p.avatarId = avatarOf(owner);
    }

    /// @notice `owner`'s avatar crystal, or 0 if none or if they no longer own it.
    function avatarOf(address owner) public view returns (uint256) {
        uint256 id = _profiles[owner].avatarId;
        if (id == 0) return 0;
        return _holderOf(id) == owner ? id : 0;
    }

    /// @notice The name `owner` holds, or "" when none.
    function nameOf(address owner) external view returns (string memory) {
        return _profiles[owner].name;
    }

    /// @notice Who holds `name`, or address(0) when nobody does.
    function addressOfName(string calldata name) external view returns (address) {
        return _addressOfName[keccak256(bytes(name))];
    }

    /// @notice 3–20 characters, each a–z, 0–9 or "_".
    function isValidName(string calldata name) public pure returns (bool) {
        bytes calldata b = bytes(name);
        if (b.length < MIN_NAME_LENGTH || b.length > MAX_NAME_LENGTH) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f)) return false;
        }
        return true;
    }

    /// @notice 1–15 characters, each a–z, A–Z, 0–9 or "_".
    function isValidX(string calldata handle) public pure returns (bool) {
        bytes calldata b = bytes(handle);
        if (b.length == 0 || b.length > MAX_X_LENGTH) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) return false;
        }
        return true;
    }

    /// @notice 1–120 bytes with no control characters (UTF-8 text is otherwise free-form).
    function isValidBio(string calldata bio) public pure returns (bool) {
        bytes calldata b = bytes(bio);
        if (b.length == 0 || b.length > MAX_BIO_LENGTH) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c < 0x20 || c == 0x7f) return false;
        }
        return true;
    }

    // ============================================================ internals

    function _setName(string calldata name, bool strict) private {
        if (!isValidName(name)) revert InvalidName();
        bytes32 key = keccak256(bytes(name));
        address holder = _addressOfName[key];
        if (holder == msg.sender) {
            if (strict) revert AlreadyYours();
            return;
        }
        if (holder != address(0)) revert NameTaken(holder);
        string memory old = _profiles[msg.sender].name;
        if (bytes(old).length != 0) _releaseName(old);
        _profiles[msg.sender].name = name;
        _addressOfName[key] = msg.sender;
        emit NameSet(msg.sender, name);
    }

    function _releaseName(string memory old) private {
        delete _addressOfName[keccak256(bytes(old))];
        delete _profiles[msg.sender].name;
        emit NameCleared(msg.sender, old);
    }

    function _setAvatar(uint256 crystalId) private {
        if (_holderOf(crystalId) != msg.sender) revert NotCrystalOwner(crystalId);
        _profiles[msg.sender].avatarId = crystalId;
        emit AvatarSet(msg.sender, crystalId);
    }

    function _setBio(string calldata bio) private {
        if (!isValidBio(bio)) revert InvalidBio();
        _profiles[msg.sender].bio = bio;
        emit BioSet(msg.sender, bio);
    }

    function _setX(string calldata handle) private {
        if (!isValidX(handle)) revert InvalidX();
        _profiles[msg.sender].x = handle;
        emit XSet(msg.sender, handle);
    }

    /// @dev The crystal's current owner, or address(0) if it doesn't exist (never minted or burned).
    function _holderOf(uint256 crystalId) private view returns (address) {
        try CRYSTAL.ownerOf(crystalId) returns (address holder) {
            return holder;
        } catch {
            return address(0);
        }
    }
}
