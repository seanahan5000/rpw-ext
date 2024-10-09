#!/bin/bash
set -x

if ! [[ -d obj ]]; then
  mkdir obj
fi

ca65 fail.asm -oobj/fail.o
ca65 pass.asm -oobj/pass.o -lobj/pass.lst -D BUILD
# ld65 --obj obj/pass.o -C apple2-asm.cfg -oobj/pass.bin

# Usage: ca65 [options] file
# Short options:
#   -D name[=value]		Define a symbol
#   -I dir			Set an include directory search path
#   -U				Mark unresolved symbols as import
#   -V				Print the assembler version
#   -W n				Set warning level n
#   -d				Debug mode
#   -g				Add debug info to object file
#   -h				Help (this text)
#   -i				Ignore case of symbols
#   -l name			Create a listing file if assembly was ok
#   -mm model			Set the memory model
#   -o name			Name the output file
#   -s				Enable smart mode
#   -t sys			Set the target system
#   -v				Increase verbosity

# Long options:
#   --auto-import			Mark unresolved symbols as import
#   --bin-include-dir dir		Set a search path for binary includes
#   --cpu type			Set cpu type
#   --create-dep name		Create a make dependency file
#   --create-full-dep name	Create a full make dependency file
#   --debug			Debug mode
#   --debug-info			Add debug info to object file
#   --feature name		Set an emulation feature
#   --help			Help (this text)
#   --ignore-case			Ignore case of symbols
#   --include-dir dir		Set an include directory search path
#   --large-alignment		Don't warn about large alignments
#   --listing name		Create a listing file if assembly was ok
#   --list-bytes n		Maximum number of bytes per listing line
#   --memory-model model		Set the memory model
#   --pagelength n		Set the page length for the listing
#   --relax-checks		Relax some checks (see docs)
#   --smart			Enable smart mode
#   --target sys			Set the target system
#   --verbose			Increase verbosity
#   --version			Print the assembler version
