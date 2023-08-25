.PHONY: release

all: send_later.xpi
clean: ; -rm -f send_later.xpi

version=$(shell grep -o '"version"\s*:\s*"\S*"' manifest.json | sed -e 's/.*"\([0-9].*\)".*/\1/')

send_later.xpi: dev/include-manifest $(shell find $(shell cat dev/include-manifest) -type f 2>/dev/null)
	rm -f "$@" "$@".tmp
	zip -q -r "$@".tmp . -i@dev/include-manifest
	mv "$@".tmp "$@"

release/send_later-${version}-tb.xpi: send_later.xpi
	mkdir -p "`dirname $@`"
	cp send_later.xpi "$@"

release: release/send_later-${version}-tb.xpi

## Requires the Node 'addons-linter' package is installed
## npm install -g addons-linter
## Note: this will produce a lot of "MANIFEST_PERMISSIONS"
## warnings because the addons-linter assumes vanilla firefox target.
lint:
	addons-linter .

unit_test: $(shell find $(shell cat dev/include-manifest) | grep -v '_locales' 2>/dev/null)
	@node test/run_tests.js 2>&1 \
		| sed -e '/^+ TEST'/s//"`printf '\033[32m+ TEST\033[0m'`"'/' \
		| sed -e '/^- TEST'/s//"`printf '\033[31m- TEST\033[0m'`"'/' \
		| sed -e 's/All \([0-9]*\) tests are passing!'/"`printf '\033[1m\033[32m'`"'All \1 tests are passing!'"`printf '\033[0m'`"/ \
		| sed -e 's/\([0-9]*\/[0-9]*\) tests failed.'/"`printf '\033[1m\033[31m'`"'\1 tests failed.'"`printf '\033[0m'`"/

test: lint unit_test
