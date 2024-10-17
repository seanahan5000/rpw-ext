#!/bin/bash
set -x

if ! [[ -d obj ]]; then
  mkdir obj
fi

64tass fail.asm -oobj/fail.o
64tass pass.asm -oobj/pass.bin -D BUILD=1

# Usage: 64tass [OPTIONS...] SOURCES
# 64tass Turbo Assembler Macro V1.52.1237?

#   -a, --ascii           Source is not in PETASCII
#   -B, --long-branch     Automatic bxx *+3 jmp $xxxx
#   -C, --case-sensitive  Case sensitive labels
#   -D <label>=<value>    Define <label> to <value>
#   -E, --error=<file>    Place errors into <file>
#   -I <path>             Include search path
#   -M <file>             Makefile dependencies to <file>
#   -q, --quiet           Do not output summary and header
#   -T, --tasm-compatible Enable TASM compatible mode
#   -w, --no-warn         Suppress warnings
#       --no-caret-diag   Suppress source line display

#  Diagnostic options:
#   -Wall                 Enable most diagnostic warnings
#   -Werror               Diagnostic warnings to errors
#   -Werror=<name>        Make a diagnostic to an error
#   -Wno-error=<name>     Make a diagnostic to a warning
#   -Wbranch-page         Warn if a branch crosses a page
#   -Wimplied-reg         No implied register aliases
#   -Wno-deprecated       No deprecated feature warnings
#   -Wno-jmp-bug          No jmp ($xxff) bug warning
#   -Wno-label-left       No warning about strange labels
#   -Wno-mem-wrap         No offset overflow warning
#   -Wno-pc-wrap          No PC overflow warning
#   -Wold-equal           Warn about old equal operator
#   -Woptimize            Optimization warnings
#   -Wshadow              Check symbol shadowing
#   -Wstrict-bool         No implicit bool conversions

#  Output selection:
#   -o, --output=<file>   Place output into <file>
#   -b, --nostart         Strip starting address
#   -f, --flat            Generate flat output file
#   -n, --nonlinear       Generate nonlinear output file
#   -X, --long-address    Use 3 byte start/len address
#       --cbm-prg         Output CBM program file
#       --atari-xex       Output Atari XEX file
#       --apple-ii        Output Apple II file
#       --intel-hex       Output Intel HEX file
#       --s-record        Output Motorola S-record file

#  Target CPU selection:
#       --m65xx           Standard 65xx (default)
#   -c, --m65c02          CMOS 65C02
#       --m65ce02         CSG 65CE02
#   -e, --m65el02         65EL02
#   -i, --m6502           NMOS 65xx
#   -t, --m65dtv02        65DTV02
#   -x, --m65816          W65C816
#       --mr65c02         R65C02
#       --mw65c02         W65C02
#       --m4510           CSG 4510

#  Source listing and labels:
#   -l, --labels=<file>   List labels into <file>
#       --vice-labels     Labels in VICE format
#       --dump-labels     Dump for debugging
#   -L, --list=<file>     List into <file>
#   -m, --no-monitor      Don't put monitor code into listing
#   -s, --no-source       Don't put source code into listing
#       --line-numbers    Put line numbers into listing
#       --tab-size=<n>    Override the default tab size (8)
#       --verbose-list    List unused lines as well

#  Misc:
#   -?, --help            Give this help list
#       --usage           Give a short usage message
#   -V, --version         Print program version

# Mandatory or optional arguments to long options are also mandatory or optional
# for any corresponding short options.
