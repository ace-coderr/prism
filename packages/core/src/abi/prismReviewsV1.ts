// PrismReviews v1 (retired): 0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3, deployed 2026-10-11, source verified
// on the explorer (and in git history before v2). Frozen copy of its ABI: PRISM only reads it, as history.

export const prismReviewsV1Abi = [
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "rating",
        "type": "uint8"
      }
    ],
    "name": "InvalidRating",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "NotAToken",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "enum PrismReviews.Status",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "NotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "NotHolder",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "heldAtPost",
        "type": "uint256"
      }
    ],
    "name": "StillHolding",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "TextTooLong",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "availableAt",
        "type": "uint256"
      }
    ],
    "name": "TooSoon",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "UnknownReview",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "author",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "rating",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "heldAtPost",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "previous",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "text",
        "type": "string"
      }
    ],
    "name": "ReviewPosted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "author",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "heldAtPost",
        "type": "uint256"
      }
    ],
    "name": "ReviewSold",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MAX_TEXT_BYTES",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "UPDATE_COOLDOWN",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "canMarkSold",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getReview",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "author",
            "type": "address"
          },
          {
            "internalType": "uint8",
            "name": "rating",
            "type": "uint8"
          },
          {
            "internalType": "enum PrismReviews.Status",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "postedAt",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "soldAt",
            "type": "uint40"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "previous",
            "type": "uint64"
          },
          {
            "internalType": "uint256",
            "name": "heldAtPost",
            "type": "uint256"
          }
        ],
        "internalType": "struct PrismReviews.Review",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "markSold",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "rating",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "text",
        "type": "string"
      }
    ],
    "name": "post",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "reviewCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "author",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "reviewOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "author",
            "type": "address"
          },
          {
            "internalType": "uint8",
            "name": "rating",
            "type": "uint8"
          },
          {
            "internalType": "enum PrismReviews.Status",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "postedAt",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "soldAt",
            "type": "uint40"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "previous",
            "type": "uint64"
          },
          {
            "internalType": "uint256",
            "name": "heldAtPost",
            "type": "uint256"
          }
        ],
        "internalType": "struct PrismReviews.Review",
        "name": "review",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
