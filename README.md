# saber-periphery

[![License](https://img.shields.io/badge/license-AGPL%203.0-blue)](https://github.com/saber-hq/saber-periphery/blob/master/LICENSE)
[![Build Status](https://img.shields.io/github/workflow/status/saber-hq/saber-periphery/E2E/master)](https://github.com/saber-hq/saber-periphery/actions/workflows/programs-e2e.yml?query=branch%3Amaster)
[![Contributors](https://img.shields.io/github/contributors/saber-hq/saber-periphery)](https://github.com/saber-hq/saber-periphery/graphs/contributors)

![Banner](/images/banner.jpg)

Peripheral contracts for interacting with Saber.

## Programs

| Package               | Description                                                          | Version                                                                                                        | Docs                                                                                             |
| :-------------------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| `add-decimals`        | Wraps another token to give it more decimals.                        | [![Crates.io](https://img.shields.io/crates/v/add-decimals)](https://crates.io/crates/add-decimals)            | [![Docs.rs](https://docs.rs/add-decimals/badge.svg)](https://docs.rs/add-decimals)               |
| `continuation-router` | Atomically routes a swap between multiple pools.                     | [![crates](https://img.shields.io/crates/v/continuation-router)](https://crates.io/crates/continuation-router) | [![Docs.rs](https://docs.rs/continuation-router/badge.svg)](https://docs.rs/continuation-router) |
| `lockup`              | Saber token lockup.                                                  | [![crates](https://img.shields.io/crates/v/lockup)](https://crates.io/crates/lockup)                           | [![Docs.rs](https://docs.rs/lockup/badge.svg)](https://docs.rs/lockup)                           |
| `mint-proxy`          | Manages the minting of new Saber tokens.                             | [![crates](https://img.shields.io/crates/v/mint-proxy)](https://crates.io/crates/mint-proxy)                   | [![Docs.rs](https://docs.rs/mint-proxy/badge.svg)](https://docs.rs/mint-proxy)                   |
| `redeemer`            | Redeems Quarry IOU tokens for Saber tokens via the Saber mint proxy. | [![crates](https://img.shields.io/crates/v/redeemer)](https://crates.io/crates/redeemer)                       | [![Docs.rs](https://docs.rs/redeemer/badge.svg)](https://docs.rs/redeemer)                       |

## NPM Packages

| Package                    | Description                        | Version                                                                                                                     | Docs                                                                                                      |
| :------------------------- | :--------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `@saberhq/saber-periphery` | TypeScript SDK for Saber Periphery | [![npm](https://img.shields.io/npm/v/@saberhq/saber-periphery.svg)](https://www.npmjs.com/package/@saberhq/saber-periphery) | [![Docs](https://img.shields.io/badge/docs-typedoc-blue)](https://saber-hq.github.io/saber-periphery/ts/) |

## Program Addresses

The Saber periphery contracts are deployed to `mainnet-beta`, `devnet`. and `testnet`.

- `add_decimals`: [DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB](https://explorer.solana.com/address/DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB)
- `continuation_router`: [Crt7UoUR6QgrFrN7j8rmSQpUTNWNSitSwWvsWGf1qZ5t](https://explorer.solana.com/address/Crt7UoUR6QgrFrN7j8rmSQpUTNWNSitSwWvsWGf1qZ5t)
- `lockup`: [LockKXdYQVMbhhckwH3BxoYJ9FYatcZjwNGEuCwY33Q](https://explorer.solana.com/address/LockKXdYQVMbhhckwH3BxoYJ9FYatcZjwNGEuCwY33Q)
- `mint_proxy`: [UBEBk5idELqykEEaycYtQ7iBVrCg6NmvFSzMpdr22mL](https://explorer.solana.com/address/UBEBk5idELqykEEaycYtQ7iBVrCg6NmvFSzMpdr22mL)
- `redeemer`: [RDM23yr8pr1kEAmhnFpaabPny6C9UVcEcok3Py5v86X](https://explorer.solana.com/address/RDM23yr8pr1kEAmhnFpaabPny6C9UVcEcok3Py5v86X)

## License

The Saber Periphery contracts are licensed under the Affero GPL License, Version 3.0.
