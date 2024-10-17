#!/bin/bash
set -x

if ! [[ -d obj ]]; then
  mkdir obj
fi

dasm fail.asm -oobj/fail
dasm pass.asm -lobj/pass.lst -f3 -oobj/pass -DBUILD

# DASM 2.20.15-SNAPSHOT
# Copyright (c) 1988-2020 by the DASM team.
# License GPLv2+: GNU GPL version 2 or later (see file LICENSE).
# DASM is free software: you are free to change and redistribute it.
# There is ABSOLUTELY NO WARRANTY, to the extent permitted by law.

# Usage: dasm sourcefile [options]

# -f#      output format 1-3 (default 1)
# -oname   output file name (else a.out)
# -lname   list file name (else none generated)
# -Lname   list file, containing all passes
# -sname   symbol dump file name (else none generated)
# -v#      verboseness 0-4 (default 0)
# -d       debug mode (for developers)
# -Dsymbol              define symbol, set to 0
# -Dsymbol=expression   define symbol, set to expression
# -Msymbol=expression   define symbol using EQM (same as -D)
# -Idir    search directory for INCLUDE and INCBIN
# -p#      maximum number of passes
# -P#      maximum number of passes, with fewer checks
# -T#      symbol table sorting (default 0 = alphabetical, 1 = address/value, 2 = order in code)
# -E#      error format (default 0 = MS, 1 = Dillon, 2 = GNU)
# -S       strict syntax checking
# -R       remove binary output-file in case of errors
# -m#      safety barrier to abort on recursions, max. allowed file-size in kB
