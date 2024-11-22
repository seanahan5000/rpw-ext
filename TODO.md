### Major Features

* Auto-detect settings
  * upper/lower case usage (opcode and/or keyword)
  * tabStops by looking at columns (with sanity checking)
* Format Document and Format Selection support
* Support files using tabs instead of spaces

### Minor Features

* Auto-complete/snippet macro begin/end and conditional do/fin pairs
* Auto-complete on disk operations should be available file names
* Apply cycle count comments to selected range of instructions
* Setting to enable full diagnostics on individual files, without requiring a project file

### Fixes

* Don't gray out conditional code in macro defs
* Rescan project file when it or workspace changes
* Enforce CPU mode on 65C02 and 65816 instructions (including INC/DEC)
