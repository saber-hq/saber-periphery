# add-decimals

Creates a wrapper token which increases the number of decimals of a token. This allows our Stable Swap algorithm to work with tokens that do not have the same number of decimals.

## About

The wrapper is a PDA account with the seeds:

- `"anchor"` (from legacy Anchor PDA derivation)
- `underlying_mint` - (mint of the underlying asset)
- `decimals` - (the number of decimals, must be greater than the decimals of the underlying's mint)

Anyone may initialize a new wrapper. To do so:

1. Compute the address of the new wrapper
2. Initialize an account for the wrapper to hold the underlying tokens.
3. Initialize a mint for the wrapper. It is recommended to use a vanity address via `solana-keygen grind`.
4. Run the `initialize_wrapper` instruction.

## License

The Saber Periphery contracts are licensed under the Affero GPL License, Version 3.0.
