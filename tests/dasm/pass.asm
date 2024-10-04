
PUHEIGHT = 1
	ldx (#PUHEIGHT-1)  ; get line count to draw player 1

; lode_runner_reveng
    BNE     .end
.end:

; unidentified file
    HEX     00 02 04 12 06 22 14 32 08 42 24 52 16 62 34 72


                incbin "filename"       ;*** quotes okay???
                incbin "filename",$100
                incdir "directory"
                include fail.asm

symbol1         equ $1000
symbol2         =   $2000
symbol3         eqm $3000
symbol4         set $4000
; symbol5         setstr var+1

                dc  0,1,2,3
                dc.b -1,1,2,3,<symbol1
                dc.b #<symbol1
                dc.w $ffff
                dc.l $7fffffff
                dc.s "test"
                byte $ff
                word 100,1000,10000,symbol1
                long $7fffffff
                dc.b #<my_sub
                dc.w my_sub

                ; *** these auto-complets have problems because of "."
                ds 10,$ee
                ds.b 10
                ds.w 1000
                ds.l 100000
                ds.l 0

label
                dv  label 10
                dv.b label 10
                dv.w label 10
                dv.l label 10

                hex 1a45 45 13254f 3e12

wait            = 1
                ifconst label
                endif
                ifconst label
                endif
                if wait
                else
                eif

                repeat 2
                repend

                org $1000
                org $1000,$ee
                rorg $2000
                rend

                seg
                seg.u
                seg my_seg

                align 256
                align 256,$ee

                processor 6502

answer = 99
                ; echo " Hex =" , answer ," Decimal =",[ answer ] d
                echo " Hex =" , answer

                subroutine
my_sub          subroutine

                mac my_mac
                mexit
                endm
                my_mac

                err

                list on
                list off
