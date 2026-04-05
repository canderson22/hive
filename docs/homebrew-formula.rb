# docs/homebrew-formula.rb
# Homebrew formula for hive
# To use: create a repo called canderson22/homebrew-tap
# and put this file at Formula/hive.rb
# Then: brew tap canderson22/tap && brew install hive

class Hive < Formula
  desc "Multi-session Claude Code coordinator"
  homepage "https://github.com/canderson22/hive"
  version "0.1.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/canderson22/hive/releases/download/v#{version}/hive-darwin-arm64"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"

      def install
        bin.install "hive-darwin-arm64" => "hive"
      end
    elsif Hardware::CPU.intel?
      url "https://github.com/canderson22/hive/releases/download/v#{version}/hive-darwin-x64"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"

      def install
        bin.install "hive-darwin-x64" => "hive"
      end
    end
  end

  on_linux do
    url "https://github.com/canderson22/hive/releases/download/v#{version}/hive-linux-x64"
    sha256 "REPLACE_WITH_ACTUAL_SHA256"

    def install
      bin.install "hive-linux-x64" => "hive"
    end
  end

  test do
    assert_match "hive", shell_output("#{bin}/hive --version")
  end
end
