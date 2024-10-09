#!/bin/bash
set -x

if ! [[ -d obj ]]; then
  mkdir obj
fi

Merlin32 fail.asm -v
Merlin32 pass.asm -v

# merlin32 v1.1.10, (c) Brutal Deluxe 2011-2015
# Usage:
#   [(-v|--verbose)[#]] [-s[#]] [<macro_dir>] <source_file>
# or
#   -h|--help to print this help and exit
#
#   <macro_dir> is the optional path to the macro folder directory. Default is /usr/local/share/merlin32/asminc
#   <source_file> is the path to the source or link file to assemble
#   -v|--verbose will write detailed output results to _outputfile.txt
#   (a number after -v will dump symbol tables to the output file)
#   -s will dump the symbol tables to the console
#   (a number after -s or -v specifies the # of columns (0 = default, which is 6)