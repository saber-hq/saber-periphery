{
  description = "Saber development environment.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    saber-overlay.url = "github:saber-hq/saber-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, saber-overlay, flake-utils }:
    flake-utils.lib.eachSystem [
      "aarch64-darwin"
      "x86_64-linux"
      "x86_64-darwin"
    ] (system:
      let
        pkgs = import nixpkgs { inherit system; }
          // saber-overlay.packages.${system};
        ci = pkgs.buildEnv {
          name = "ci";
          paths = with pkgs;
            (pkgs.lib.optionals pkgs.stdenv.isLinux ([ udev ])) ++ [
              anchor-0_19_0
              cargo-workspaces
              solana-basic

              # sdk
              nodejs
              yarn
              python3

              pkgconfig
              openssl
              jq
              gnused

              libiconv
            ] ++ (pkgs.lib.optionals pkgs.stdenv.isDarwin
              (with pkgs.darwin.apple_sdk.frameworks; [
                AppKit
                IOKit
                Foundation
              ]));
        };
      in {
        packages.ci = ci;
        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            ci
            rustup
            cargo-deps
            gh
            spl-token-cli
          ];
        };
      });
}
