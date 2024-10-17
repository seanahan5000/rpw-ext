#!/bin/bash
set -x

if ! [[ -d obj ]]; then
  mkdir obj
fi

acme fail.asm
acme -DBUILD=1 -l obj/pass.lst -o obj/pass.bin pass.asm

# Usage:
# acme [OPTION...] [FILE]...
#
# Options:
#   -h, --help             show this help and exit
#   -f, --format FORMAT    set output file format
#   -o, --outfile FILE     set output file name
#   -r, --report FILE      set report file name
#   -l, --symbollist FILE  set symbol list file name
#       --labeldump        (old name for --symbollist)
#       --vicelabels FILE  set file name for label dump in VICE format
#       --setpc NUMBER     set program counter
#       --cpu CPU          set target processor
#       --initmem NUMBER   define 'empty' memory
#       --maxerrors NUMBER set number of errors before exiting
#       --maxdepth NUMBER  set recursion depth for macro calls and !src
#   -vDIGIT                set verbosity level
#   -DSYMBOL=VALUE         define global symbol
#   -I PATH/TO/DIR         add search path for input files
#   -Wno-label-indent      suppress warnings about indented labels
#   -Wno-old-for           suppress warnings about old "!for" syntax
#   -Wtype-mismatch        enable type checking (warn about type mismatch)
#       --use-stdout       fix for 'Relaunch64' IDE (see docs)
#       --msvc             output errors in MS VS format
#       --color            uses ANSI color codes for error output
#       --fullstop         use '.' as pseudo opcode prefix
#   -V, --version          show version and exit
