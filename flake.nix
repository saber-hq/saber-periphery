{
  description = "Saber development environment.";

  inputs = {
    saber-overlay.url = "github:saber-hq/saber-overlay";
  };

  outputs = { self, saber-overlay }: saber-overlay.lib.buildFlakeOutputs { };
}
