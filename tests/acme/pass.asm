
                * = $1000

test1           !zone
                bne .loc1
                beq .loc2
                jsr test2
.loc1
.loc2:

test2:          !zone
                bne .loc1
                beq .loc2
                jsr test1

.loc1
.loc2:


; ; passport/choplifter.a
;         ;  lda   (*+$ff) and $ff00,x

* = $1000       ; required or locals fail to resolve
-               ; anonymous locals
                beq -
                bne +
+

.insuffText : !text "REQUIRES 128K IIE OR LATER.",0


symbol          =   $10
symbol1         =   $20
symbol2         =   $30
tz              =   3
l1              =   $1000
.j2             =   $F000
a               =   $12345678  ; TODO: assembler fails with "Symbol already defined"
a1              =   1234
a2              =   5678
BUFSIZE         =   99

; *** TODO: assembler warns on strange number of binary digits ***
                !08 127, symbol, -128
                !by 14, $3d, %0110, <*, "c"
                ; !by &304
                !byte 3 - 4, symbol1 XOR symbol2, 2 ^ tz, (3+4)*7
                !16 65535, symbol, -32768
                !wo 14, $4f35, %100101010010110, *, "c"
                ; !wo &36304
                !word 3000 - 4, a1 AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !le16 65535, symbol, -32768
                !le16 14, $4f35, %100101010010110, *, "c"
                !le16 3000 - 4, a1 AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !be16 65535, symbol, -32768
                !be16 14, $4f35, %100101010010110, *, "c"
                !be16 3000 - 4, a1 AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !24 16777215, symbol, -8388608, 14, $6a4f35
                !24 %10010110100101010010110, *, "c"
                ; !24 &47336304
                !24 300000 - 4, a1 AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !le24 16777215, symbol, -8388608, 14, $6a4f35
                !le24 %10010110100101010010110, *, "c"
                !le24 300000 - 4, a1 AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !be24 16777215, symbol, -8388608, 14, $6a4f35
                !be24 %10010110100101010010110, *, "c"
                !be24 300000 - 4, a1 AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !32 $7fffffff, symbol, -$80000000, 14, $46a4f35
                !32 %1001011010010101001011010010, *, "c"
                ; !32 &4733630435
                !32 300000 - 4, a AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !le32 $7fffffff, symbol, -$80000000, 14, $46a4f35
                !le32 %1001011010010101001011010010, *, "c"
                !le32 300000 - 4, a AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !be32 $7fffffff, symbol, -$80000000, 14, $46a4f35
                !be32 %1001011010010101001011010010, *, "c"
                !be32 300000 - 4, a AND a2, 2 ^ tz, (3+4)*70, l1 & .j2
                !h f0 f1 f2 f3 f4 f5 f6 f7
                !h f0f1f2f3 f4f5f6f7
                !h f0f1f2f3f4f5f6f7
                !fi 256, $ff
                !fill 2
                !skip BUFSIZE
                !skip 5
                !align 255, 0
                !align 63, 0, $EA
                !convtab raw
                !text "Test"
                !ct pet
                !tx "Test"
                !ct scr {
                    !tx "Test"
!ifndef BUILD {
                    !ct "my_own_table_file"
}
                    !tx "abcdefg"
                }
                !tx "Test"

                !text '"'
                !text "'"
                !text "\\"
                !text "\""
                !text "\'"
                !text "\t"
                !text "\n"
                !text "\r"
                !text "\0"

Char_NewLine    =   $8d
offset          =   99
                !text "Loading...", Char_NewLine, "Filename:", 0
                !tx "Offset character is ", offset - 1 + 'a', 0
                !pet "Loading...", Char_NewLine, "Filename:", 0
                !pet "Offset character is ", offset - 1 + 'a', 0
                !raw "Loading...", Char_NewLine, "Filename:", 0
                !raw "Offset character is ", offset - 1 + 'a', 0
                !scr "Loading...", Char_NewLine, "Filename:", 0
                !scr "Offset character is ", offset - 1 + 'a', 0
                !scrxor $80, "Loading..."
                !scrxor $a0, "Offset char is ", (offset-1+'a') XOR $a0
                !to "eprom.p", plain
!ifndef BUILD {
                !to "demo.o", cbm
                !to "demo.o",apple
                !source <./pass.inc>
}
                !src "pass.inc"
!ifndef BUILD {
                !binary <Own/menudata.b>
                !bin "asc2pet.b", 256, 2
                !bin "table", 2, 9
                !bin "list",, 9
}
                !zone File_IO
                !zn LinkedList_Init
                !zone LinkedList {
                }
                !sl "global"
                ; !ifndef my_label { my_label }
                ; !if * = my_label {
                ; }
                !ifdef my_label {
                } else {
                }
                !for Outer, 0, 9 {
                    !for Inner, 0, 9 {
                        !byte (Outer << 4) OR Inner
                    }
                }
                !set a = 0
                ; !do while loop_flag = TRUE {
                ;     lda #a
                ;     sta label + a
                ;     !set a = a + 1
                ; } until a > 6
                ; !do while * < $c000 { nop }
                ; !do { !wo * + base } while * < base + 345
                ; !do while 3 < 4 { nop } until 3 = 4
                ; !do until 3 = 4 {     } while 3 < 4
                !if * > $a000 {
                    !warn "Program reached ROM: ", * - $a000, " bytes overlap."
                }
start           !source "pass.inc"
end             !if end - start > 256 {
                    !error "Color strings are ", end - start - 256, " bytes too long."
                }
                ; !source "pass.inc"
                ; !source "pass.inc"
                ; !if part1_version != part2_version {
!ifndef BUILD {
                    !serious "part1.a and part2.a don't match!"
}
                ; }

                * = $8010, overlay, invisible

                !macro simple {
                }
                !macro bne .target {
                    beq * + 5
                    jmp .target
                }

                +bne end
+bne end

                !initmem $ea

                !xor $80 {
                }
                !pseudopc $0400 {
                }

                !cpu 6502
                !cpu 65816
                !cpu 65c02 {
                }

                !addr k_chrout = $ffd2
                !addr {
                    sid_v1_control	= $d404
                }

                ; inline !if clause
                DEBUG = 1
                !if DEBUG >= 2 { jsr .debug2 }

                !eof
                !endoffile
