
                processor 6502

                dc.b "\\"
                ; dc.b "\""              ; *** problem
                ; dc.b '"'               ; *** problem
                dc.b "'"
                dc.b "\'"
                dc.b "\r"
                dc.b "\n"
                dc.b "\t"
                dc.b "\x1F"


PUHEIGHT = 1
	ldx (#PUHEIGHT-1)  ; get line count to draw player 1

lode_runner_reveng
    BNE     .end
.end:

.WAITOBJECT:
    BCS     .WAITOBJECT

	MAC STACKALLOC
{1} EQU	STACKBASE
STACKBASE SET STACKBASE-1
	ENDM
	MAC STACKALLOCN
{1} EQU	STACKBASE+1{2}
STACKBASE SET STACKBASE-{2}
	ENDM

 echo "---- ",((TEXT_BASE+1) - FREERAM)d, "ROOM BETWEEN TEXT_BASE AND FREERAM"

	SEG.U VARS
	org $80

	; include ..\..\DASM\machines\atari2600\vcs.h

    ifnconst BUILD
                incbin "filename"       ;*** quotes okay???
                incbin "filename",$100
                incdir "directory"
    endif

                include "pass.inc"      ;*** quotes required?
                ; include .\ pass.inc  ;*** escaped space

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

                ; dc.s "X\\X\"X\'X\rX\nX\tX\x1F"
                dc.s "\\"
                ; dc.s "\""              ; *** problem
                ; dc.s '"'
                dc.s "'"
                dc.s "\'"
                dc.s "\r"
                dc.s "\n"
                dc.s "\t"
                dc.s "\x1F"

                byte $ff
                word 100,1000,10000,symbol1
                long $7fffffff
                dc.b #<my_sub
                dc.w my_sub

                ; *** these auto-completes have problems because of "."
                ds 10,$ee
                ds.b 10
                ds.w 1000
                ds.l 100000
                ds.l 0

;     ifnconst BUILD
; label
;                 dv  label 10
;                 dv.b label 10
;                 dv.w label 10
;                 dv.l label 10
;     endif

                hex 1a45 45 13254f 3e12

wait            = 1
                ; ifconst label
                ; endif
                ; ifconst label
                ; endif
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

    ifnconst BUILD
answer = 99
                ; echo " Hex =" , answer ," Decimal =",[ answer ] d
                echo " Hex =" , answer
    endif

                subroutine
my_sub          subroutine

                mac my_mac
                mexit
                endm
                my_mac

    ifnconst BUILD
                err
    endif

                list on
                list off
