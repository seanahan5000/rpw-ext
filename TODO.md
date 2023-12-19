### Major Features

* Auto-detect settings
  * syntax by looking at keyword usage
  * upper/lower case usage (opcode and/or keyword)
  * tabStops by looking at columns (with sanity checking)
* Format Document and Format Selection support
* Support files using tabs instead of spaces
* Code folding on symbol scope/zone borders

### Minor Features

* Auto-complete/snippet macro begin/end and conditional do/fin pairs

### Fixes

* Tab jumps too far when opcode > 3 characters
* Don't gray out conditional code in macro defs
* Rescan project file when it changes
* Add more keywords to rpw65.tmLanguage.json
* Enforce CPU mode on 65C02 and 65816 instructions (including INC/DEC)
