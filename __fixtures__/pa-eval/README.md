# PA Eval Fixtures

`cases/` contains passing deterministic fixtures used by
`npm run eval:pa:fast`.

`negative-cases/` contains fixtures that tests intentionally run to verify the
runner fails private-source and raw-excerpt leaks. The fast eval command does
not load negative cases by default.
