require("babel-polyfill");
require("babel-core/register")({
  extensions: [".js"],
  presets: ["es2015", "stage-0"]
});

require("./app.js");
