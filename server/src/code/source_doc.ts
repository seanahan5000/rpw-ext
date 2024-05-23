// import { Disassembler } from "./disasm"
import { IMachineMemory } from "./shared"
import { RpwSettings } from "../rpw_types"

//------------------------------------------------------------------------------

// used when saving/restoring breakpoints and watches
export class SourceLineTemplate {
  address: number
  objData: number[]
  label: string
  opcode: string
  args: string
  prevLabel?: string
  prevLineOffset?: number

  constructor(sourceLine: SourceLine) {
    this.address = sourceLine.address

    // TODO: is there a JS method to do this?
    this.objData = []
    for (let i = 0; i < sourceLine.objLength; i += 1) {
      this.objData.push(sourceLine.objBuffer![sourceLine.objOffset + i])
    }

    this.label = sourceLine.label
    this.opcode = sourceLine.opcode
    this.args = sourceLine.args

    // TODO: pass these in separately
    this.prevLabel = sourceLine.prevLabel
    this.prevLineOffset = sourceLine.prevLineOffset
  }
}

// TODO: will need "byte", ".byte", "word", ".word"
const storageOps = ["ds", "dfb", "db", "dw", "hex"]

function isStorageOpcode(opStr: string): boolean {
  let opStrLC = opStr.toLowerCase()
  return (storageOps.indexOf(opStrLC) > -1) ||
  opStrLC.startsWith("dc.") || opStrLC[0] == "."
}

// TODO: support constant values
export class SourceLine {
  address = -1
  objBuffer?: Uint8Array   // usually equal to sourceDoc.objBuffer
  objOffset = 0
  objLength = 0
  label: string = ""
  opcode: string = ""
  args: string = ""
  comment: string = ""
  commentColumn?: number

  // only if sourceLine does have breakpoint
  hasBreakpoint?: boolean

  // TODO: compute only when saving template as part of breakpoint
  prevLabel?: string
  prevLineOffset?: number

  // NOTE: only valid during build and deleted afterwards
  fileLine?: number
  objData?: number[]

  constructor(template?: SourceLineTemplate) {
    if (template) {
      this.address = template.address
      this.objBuffer = Uint8Array.from(template.objData)
      this.objLength = template.objData.length
      this.objOffset = 0
      this.label = template.label
      this.opcode = template.opcode
      this.args = template.args

      // TODO: only for breakpoints
      this.prevLabel = template.prevLabel
      this.prevLineOffset = template.prevLineOffset
    }
  }

  isStorageOp(): boolean {
    return isStorageOpcode(this.opcode)
  }

  splitBeforeAddress(beforeAddress: number): SourceLine | undefined {
    if (this.address == -1 || this.address + this.objLength <= beforeAddress) {
      // TODO: throw exception?
      console.log("Bad splitBeforeAddress")
      return
    }
    let nextLine = new SourceLine()
    nextLine.address = beforeAddress
    nextLine.objBuffer = this.objBuffer
    nextLine.objOffset = this.objOffset + (beforeAddress - this.address)
    nextLine.objLength = this.address + this.objLength - beforeAddress
    nextLine.opcode = ".bulk"
    // TODO: show bytes instead
    nextLine.args = "..."
    this.objLength -= nextLine.objLength
    // TODO: regenerate this.args if .bulk
    return nextLine
  }

  splitBeforeOffset(beforeOffset: number): SourceLine | undefined {
    if (this.address == -1 || this.objOffset + this.objLength <= beforeOffset) {
      // TODO: throw exception?
      console.log("Bad splitBeforeOffset")
      return
    }
    let nextLine = new SourceLine()
    nextLine.address = this.address + beforeOffset - this.objOffset
    nextLine.objBuffer = this.objBuffer
    nextLine.objOffset = beforeOffset
    nextLine.objLength = this.objOffset + this.objLength - beforeOffset
    nextLine.opcode = ".bulk"
    // TODO: show bytes instead
    nextLine.args = "..."
    this.objLength -= nextLine.objLength
    // TODO: regenerate this.args if .bulk
    return nextLine
  }
}

class SourceRange {
  startAddress = -1
  endAddress = -1    // inclusive
  map = new Map()
}

//------------------------------------------------------------------------------

export class SourceDoc {
  protected memory?: IMachineMemory
  public name: string             // full path name
  public lstFileName: string
  public settings: RpwSettings
  objBuffer?: Uint8Array
  // TODO: read private once sourceRanges is getting cleared
  sourceLines: SourceLine[] = []
  // sourceRanges: SourceRange[] = []
  private text: string = ""
  // disassembler?: Disassembler

  // NOTE: only valid during build and deleted afterwards
  objData?: number []

  constructor(memory: IMachineMemory | undefined, fullPathName: string, lstFileName: string, settings: RpwSettings) {
    this.memory = memory
    this.name = fullPathName
    this.lstFileName = lstFileName
    this.settings = settings
  }

  calcLoadedPercent(): number {
    let matchCount = 0
    let byteCount = 0
    for (let i = 0; i < this.sourceLines.length; i += 1) {
      let sourceLine = this.sourceLines[i]
      // NOTE: limit to 16 is for dis65 where blocks can be large
      let checkCount = Math.min(sourceLine.objLength, 16)
      for (let j = 0; j < checkCount; j += 1) {
        // TODO: this won't work correctly if crossing an offset/address boundary
        byteCount += 1
        if (this.memory?.readConst(sourceLine.address + j) == sourceLine.objBuffer![sourceLine.objOffset + j]) {
          matchCount += 1
        }
      }
      // stop checking if percent would be too low after some number of bytes
      if (byteCount >= 256 && matchCount / byteCount < .10) {
        break
      }
    }
    return matchCount / byteCount
  }

  // Check if enough (90%) of memory matches document contents to consider
  //  the file as being empty.  Allow for self-modified code.
  isLoaded(address: number): boolean {
    let loaded = false
    let results = this.findLinesByAddress(address)
    if (results.length > 0) {
      for (let value of results) {
        let startIndex = value
        let endIndex = value
        // on the first pass, check just the exact line that matches the address
        // on the second pass, check 8 lines before and after the matched line
          // TODO: there's a problem if the address is at the start or end of a block
        for (let pass = 0; pass < 2; pass += 1) {

          let matchCount = 0
          let byteCount = 0
          for (let i = startIndex; i <= endIndex; i += 1) {
            let sourceLine = this.sourceLines[i]
            // NOTE: limit to 16 is for dis65 where blocks can be large
            let checkCount = Math.min(sourceLine.objLength, 16)
            for (let j = 0; j < checkCount; j += 1) {
              // TODO: this won't work correctly if crossing an offset/address boundary
              byteCount += 1
              if (this.memory?.readConst(sourceLine.address + j) == sourceLine.objBuffer![sourceLine.objOffset + j]) {
                matchCount += 1
              }
            }
          }

          if (matchCount / byteCount >= .75) {
            loaded = true
            break
          }
          if (pass == 1) {
            break
          }
          for (let i = 0; i < 8; i += 1) {
            while (startIndex > 0) {
              startIndex -= 1
              if (this.sourceLines[startIndex].objLength > 0) {
                break
              }
            }
            while (endIndex < this.sourceLines.length - 1) {
              endIndex += 1
              if (this.sourceLines[endIndex].objLength > 0) {
                break
              }
            }
          }
        }
      }
    }
    return loaded
  }

  private findLinesByAddress(address: number): number[] {
    let results = []
    // TODO: change this to a binary search by group for better perf
    for (let i = 0; i < this.sourceLines.length; i += 1) {
      let sourceLine = this.sourceLines[i]
      if (address >= sourceLine.address && address < sourceLine.address + sourceLine.objLength) {
        results.push(i)
      }
    }
    return results
  }

  findLineByAddress(address: number): number {
    let results = this.findLinesByAddress(address)
    let result = -1
    if (results.length > 0) {
      if (results.length > 1) {
        // if more than one match is found, return the one that most matches memory
        let bestCount = -1
        for (let value of results) {
          let sourceLine = this.sourceLines[value]
          let matchCount = 0
          for (let i = 0; i < sourceLine.objLength; i += 1) {
            if (this.memory?.readConst(sourceLine.address + i) == sourceLine.objBuffer![sourceLine.objOffset + i]) {
              matchCount += 1
            }
          }
          matchCount /= sourceLine.objLength
          if (bestCount < matchCount) {
            bestCount = matchCount
            result = value
          }
        }
      } else {
        result = results[0]
      }
    }
    return result
  }

  // build contiguous ranges of non-overlapping source ranges
  // private buildRanges() {
  //   this.sourceRanges = []
  //   let sourceRange = new SourceRange()
  //   let prevLine: SourceLine
  //
  //   // TODO: stop using forEach
  //   this.sourceLines.forEach((srcLine, index) => {
  //     // only lines with data will be included in a range and added to its map
  //     if (srcLine.objLength != 0) {
  //       if (prevLine) {
  //         let addressDelta = srcLine.address - prevLine.address
  //         if (addressDelta < 0 || addressDelta > 255) {
  //           sourceRange.endAddress = prevLine.address + prevLine.objLength - 1
  //           this.sourceRanges.push(sourceRange)
  //           sourceRange = new SourceRange()
  //         }
  //       }
  //       if (sourceRange.startAddress == -1) {
  //         sourceRange.startAddress = srcLine.address
  //       }
  //       sourceRange.map.set(srcLine.address, index)
  //       prevLine = srcLine
  //     }
  //   })
  //
  //   // flush final in-progress range, if any
  //   if (sourceRange.startAddress != -1) {
  //     sourceRange.endAddress = prevLine.address + prevLine.objLength - 1
  //     this.sourceRanges.push(sourceRange)
  //   }
  // }

  // brute force search for line matching label (not performance critical)
  //  (only used for loading breakpoints and finding nearest label)
  findLineByLabel(label: string): number {
    for (let i = 0; i < this.sourceLines.length; i += 1) {
      if (this.sourceLines[i].label == label) {
        return i
      }
    }
    return -1
  }

  // recreate an approximation of the original source files,
  //  without addresses or data bytes
  getText(): string {
    if (!this.text) {
      this.text = ""
      for (let i = 0; i < this.sourceLines.length; i += 1) {
        let lineText = this.buildTextLine(this.sourceLines[i])
        this.text += lineText
        // if (i == this.sourceLines.length - 1 && lineText.length == 0) {
        //   break
        // }
        this.text += "\n"
      }
    }
    return this.text
  }

  // Rebuild a single line of text (label, opcode, args, comment)
  // Use for initial build and when code has been self-modified
  public buildTextLine(inLine: SourceLine, offsets?: number []): string {
    let outLine = ""
    if (inLine.label.length != 0 || inLine.opcode.length != 0 || inLine.args.length != 0) {

      // <label>
      if (offsets) {
        offsets.push(outLine.length)    // 0 - start of label
      }
      if (inLine.label.length != 0) {
        outLine += inLine.label
      }
      if (offsets) {
        offsets.push(outLine.length)    // 1 - end of label
      }

      let conditional = false

      // <opcode>
      let tempLabelWidth = this.settings.tabStops[0]
      if (inLine.opcode.length != 0) {

        // special case indentation of conditionals
        let opLow = inLine.opcode.toLowerCase()
        if (opLow == "if" || opLow == "do" || opLow == "else" || opLow == "fin") {
          tempLabelWidth -= 4
        }

        outLine = outLine.padEnd(tempLabelWidth - 1) + " "
        if (offsets) {
          offsets.push(outLine.length)  // 2 - start of opcode
        }
        outLine += inLine.opcode
      } else {
        if (offsets) {
          offsets.push(outLine.length)  // 2 - start of opcode (empty)
        }
      }
      if (offsets) {
        offsets.push(outLine.length)    // 3 - end of opcode
      }

      // <arguments>
      if (inLine.args.length != 0) {
        outLine = outLine.padEnd(this.settings.tabStops[1] - 1) + " "
        if (offsets) {
          offsets.push(outLine.length)  // 4 - start of args
        }
        outLine += inLine.args
      } else {
        if (offsets) {
          offsets.push(outLine.length)  // 4 - start of args (empty)
        }
      }
      if (offsets) {
        offsets.push(outLine.length)    // 5 - end of args
      }

      // <comment>
      if (offsets) {
        offsets.push(outLine.length)
      }

      if (inLine.comment.length != 0) {
        outLine = outLine.padEnd(this.settings.tabStops[2] - 1) + " "
        if (offsets) {
          offsets.push(outLine.length)  // 6 - start of comment
        }
        outLine += inLine.comment
      } else {
        if (offsets) {
          offsets.push(outLine.length)  // 6 - start of comment (empty)
        }
      }
      if (offsets) {
        offsets.push(outLine.length)    // 7 - end of comment
      }
    } else {
      // <comment> at start of line
      if (offsets) {
        offsets.push(0)
        offsets.push(0)
        offsets.push(0)
        offsets.push(0)
        offsets.push(0)
        offsets.push(0)
      }
      if (inLine.comment.length != 0) {
        if (inLine.commentColumn) {
          outLine = outLine.padEnd(inLine.commentColumn)
        }
        if (offsets) {
          offsets.push(outLine.length)  // 6 - start of comment
        }
        outLine += inLine.comment
      } else {
        if (offsets) {
          offsets.push(outLine.length)  // 6 - start of comment (empty)
        }
      }
      if (offsets) {
        offsets.push(outLine.length)    // 7 - end of comment
      }
    }

    return outLine
  }
}

//------------------------------------------------------------------------------
