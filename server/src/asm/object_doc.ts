
import { SourceFile } from "./project"
import { Statement } from "./statements"
import { LineRecord, Segment } from "./assembler"

//------------------------------------------------------------------------------

// Convert encode data buffers coming in from breakpoints
//  and stack traces into a utility class object.

export class DataRange {
  public address: number
  public bytes: Uint8Array

  constructor(dataAddress: number, dataBytes: Uint8Array) {
    this.address = dataAddress
    this.bytes = dataBytes
  }

  public compare(inAddress: number, inBytes: number[] | Uint8Array, inOffset = 0, inCount?: number): number {
    if (inCount === undefined) {
      inCount = inBytes.length
    }
    if (inAddress < this.address) {
      inOffset = this.address - inAddress
      inCount -= inOffset
      inAddress = this.address
    }

    let thisOffset = 0
    if (inAddress > this.address) {
      thisOffset = inAddress - this.address
    }

    const overhang = thisOffset + inCount - this.bytes.length
    if (overhang > 0) {
      inCount -= overhang
    }

    let matches = 0
    for (let i = 0; i < inCount; i += 1) {
      if (inBytes[inOffset + i] == this.bytes[thisOffset + i]) {
        matches += 1
      }
    }
    return matches
  }

  public get startAddress(): number {
    return this.address
  }

  public get endAddress(): number {
    return this.address + this.bytes.length
  }

  public get dataLength(): number {
    return this.bytes.length
  }
}

//------------------------------------------------------------------------------

class ObjectRange {

  // starting position in source file, zero-based
  public startLine: number = 0

  // valid after finalize
  private dataRange?: DataRange
  private refRange?: DataRange

  // one per source line, plus terminator, relative to dataRange
  private offsets: number[] = [0]

  // used while collecting object data
  public buildSegment: Segment
  public buildStartAddress?: number
  public buildStartOffset: number   // starting offset into segment data
  public buildCurrOffset: number    // current offset, relative to baseOffset

  constructor(startLine: number, segment: Segment, preOffset: number) {
    this.startLine = startLine
    this.buildSegment = segment
    this.buildStartOffset = (segment.dataArray?.length ?? 0) - preOffset
    this.buildCurrOffset = 0
  }

  public addLine(address: number | undefined, byteCount: number, isHidden: boolean) {
    this.buildCurrOffset += byteCount
    if (isHidden) {
      // add to previous offset instead of adding a new one
      this.offsets[this.offsets.length - 1] = this.buildCurrOffset
    } else {
      // commit to a start address when a valid address first comes through
      if (this.buildStartAddress === undefined) {
        if (address !== undefined) {
          this.buildStartAddress = address
        }
      }
      this.offsets.push(this.buildCurrOffset)
    }
  }

  public finalize() {
    if (this.buildCurrOffset > 0 && this.buildStartAddress !== undefined) {
      this.buildSegment.finalize()
      const startOffset = this.buildStartOffset
      const endOffset = startOffset + this.buildCurrOffset
      const subData = this.buildSegment.dataBytes!.subarray(startOffset, endOffset)
      this.dataRange = new DataRange(this.buildStartAddress, subData)
      if (this.buildSegment.refBytes) {
        const refData = this.buildSegment.refBytes.subarray(startOffset, endOffset)
        this.refRange = new DataRange(this.buildStartAddress, refData)
      }
    }
  }

  public get endLine(): number {
    return this.startLine + this.offsets.length  - 1
  }

  public get startAddress(): number {
    return this.dataRange?.startAddress ?? 0
  }

  public get dataLength(): number {
    return this.dataRange?.dataLength ?? 0
  }

  public getAddress(lineNumber: number): number {
    return (this.dataRange?.address ?? 0) + this.offsets[lineNumber - this.startLine]
  }

  public getDataBytes(lineNumber: number): number[] | undefined {
    if (this.offsets.length > 1) {
      const startOffset = this.offsets[lineNumber - this.startLine]
      const endOffset = this.offsets[lineNumber - this.startLine + 1]
      if (startOffset != endOffset) {
        if (this.dataRange) {
          // check against reference data and report mismatches as negative values
          const dataBytes: number[] = []
          for (let i = startOffset; i < endOffset; i += 1) {
            let val = this.dataRange.bytes[i]
            if (this.refRange) {
              if (val != this.refRange.bytes[i]) {
                val = -val
              }
            }
            dataBytes.push(val)
          }
          return dataBytes
        }
      }
    }
  }

  public matchRange(dataRange: DataRange): number {
    return this.dataRange?.compare(dataRange.address, dataRange.bytes) ?? 0
  }

  public getLine(address: number): number | undefined {
    const offset = address - this.startAddress
    let minOffset = 0
    let maxOffset = this.offsets[0]
    for (let i = 1; i < this.offsets.length; i += 1) {
      minOffset = maxOffset
      maxOffset = this.offsets[i]
      if (offset >= maxOffset) {
        continue
      }
      if (offset < minOffset) {
        break
      }
      return this.startLine + i - 1
    }
  }
}

//------------------------------------------------------------------------------

export type RangeMatch = {
  objectDoc: ObjectDoc
  sourceLine: number
  matchCount: number
}

export type ObjectLine = {
  statement: Statement
  dataAddress?: number
  dataBytes?: number[]
}

// each module has a list of these object files
export class ObjectDoc {

  public sourceFile: SourceFile

  // zero or more ranges of memory covered by file
  private objectRanges: ObjectRange[] = []

  constructor(sourceFile: SourceFile) {
    this.sourceFile = sourceFile
  }

  // called once for every line in source file
  public addLine(line: LineRecord, byteCount: number) {
    let curRange: ObjectRange | undefined
    if (this.objectRanges.length) {
      curRange = this.objectRanges[this.objectRanges.length - 1]
    }
    if (curRange && !line.isHidden) {
      // check for segment discontinuity
      if (line.statement.segment != curRange.buildSegment) {
        curRange = undefined
      } else if (line.statement.segment?.isInitialized) {
        // check for address discontinuity
        if (line.statement.PC !== undefined && curRange.buildStartAddress !== undefined) {
          if (line.statement.PC != curRange.buildStartAddress + curRange.buildCurrOffset) {
            curRange = undefined
          }
        }
      }
    }
    if (!curRange) {
      // TODO: this segment check is only needed to cover for anonymous enums until fixed
      if (line.statement.segment) {
        // NOTE: byteCount is passed in as pre offset to compensate
        //  for bytes already added to segment dataArray
        curRange = new ObjectRange(line.lineNumber, line.statement.segment, byteCount)
        this.objectRanges.push(curRange)
      }
    }

    curRange?.addLine(line.statement.PC, byteCount, line.isHidden ?? false)
  }

  public finalize() {
    for (let objRange of this.objectRanges) {
      objRange.finalize()
    }
  }

  // to support converting a PC value to a source file and line
  public findRanges(dataPC: number, dataRange?: DataRange): RangeMatch[] {
    const matches: RangeMatch[] = []
    const dataStart = dataRange ? dataRange.startAddress : dataPC
    const dataEnd = dataRange ? dataRange.endAddress : dataPC + 1
    for (let objRange of this.objectRanges) {
      if (dataStart >= objRange.startAddress + objRange.dataLength) {
        continue
      }
      if (dataEnd <= objRange.startAddress) {
        break
      }
      // NOTE: dataRange could partially overlap objRange but dataPC may not
      const sourceLine = objRange.getLine(dataPC)
      if (sourceLine) {
        matches.push({
          objectDoc: this,
          sourceLine,
          matchCount: dataRange ? objRange.matchRange(dataRange) : 1
        })
      }
    }
    return matches
  }

  public getObjectLines(startLine: number, endLine?: number): ObjectLine[] {
    const result: ObjectLine[] = []

    let lineNum = startLine
    if (endLine === undefined) {
      endLine = startLine + 1
    }

    for (let range of this.objectRanges) {
      if (range.endLine <= lineNum) {
        continue
      }
      if (range.startLine > lineNum) {
        break
      }
      while (lineNum < endLine) {
        const statement = this.sourceFile.statements[lineNum]
        const dataBytes = range.getDataBytes(lineNum)
        const dataAddress = dataBytes ? range.getAddress(lineNum) : undefined
        result.push({ statement, dataAddress, dataBytes })
        if (++lineNum == range.endLine) {
          break
        }
      }
    }

    return result
  }
}

//------------------------------------------------------------------------------
