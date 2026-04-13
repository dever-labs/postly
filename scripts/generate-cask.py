#!/usr/bin/env python3
"""Generate a Homebrew Cask formula for Postly.

Usage: generate-cask.py <version> <arm64-sha256> <x64-sha256>

Outputs the complete cask to stdout so the caller can redirect it to the
correct file in the homebrew-tap repository.
"""

import sys

# %(...)s placeholders are used instead of f-strings so that Ruby's #{version}
# interpolation syntax in the URL strings is preserved verbatim.
CASK_TEMPLATE = """\
cask "postly" do
  version "%(version)s"

  on_arm do
    url "https://github.com/dever-labs/postly/releases/download/v#{version}/Postly-#{version}-arm64.dmg"
    sha256 "%(arm64_sha)s"
  end

  on_intel do
    url "https://github.com/dever-labs/postly/releases/download/v#{version}/Postly-#{version}.dmg"
    sha256 "%(x64_sha)s"
  end

  name "Postly"
  desc "API client for developers"
  homepage "https://github.com/dever-labs/postly"

  app "Postly.app"

  # Ad-hoc re-sign so macOS 26+ dyld Team ID enforcement doesn't block launch.
  # The unsigned build has no Team ID but the bundled Electron Framework does;
  # re-signing with "-" makes all components consistent.
  postflight do
    system_command "/usr/bin/codesign",
                   args: ["--deep", "--force", "--sign", "-", "#{appdir}/Postly.app"],
                   sudo: true
  end

  zap trash: [
    "~/Library/Application Support/Postly",
    "~/Library/Logs/Postly",
    "~/Library/Preferences/com.deverlabs.postly.plist",
  ]
end
"""


def main() -> None:
    if len(sys.argv) != 4:
        print(
            f"Usage: {sys.argv[0]} <version> <arm64-sha256> <x64-sha256>",
            file=sys.stderr,
        )
        sys.exit(1)

    version, arm64_sha, x64_sha = sys.argv[1], sys.argv[2], sys.argv[3]
    print(
        CASK_TEMPLATE % {"version": version, "arm64_sha": arm64_sha, "x64_sha": x64_sha},
        end="",
    )


if __name__ == "__main__":
    main()
