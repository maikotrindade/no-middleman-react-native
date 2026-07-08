# no-middleman-rn

CLI for **No Middleman** — Loop Engineering for React Native. `nm verify` is
the trustworthy oracle that Claude Code's `/goal` loop iterates against: it
runs typecheck, lint, unit, build, and (optionally) a Detox E2E gate,
cheap→expensive, and exits 0 only when everything is green.

Full project docs: https://github.com/maikotrindade/no-middleman-react-native

## Install

```sh
npm install --save-dev no-middleman-rn
```

## Usage

```sh
nm verify              # typecheck, lint, unit, build
nm verify --e2e         # also runs the Detox E2E gate
nm verify --cwd <dir>   # run against a different working directory
```

Exit code `0` means every hard verifier passed. Any non-zero exit means at
least one gate is red — that's the signal the loop treats as "not done yet."

## License

MIT
