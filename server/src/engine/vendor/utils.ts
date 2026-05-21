// Vendored from js-chess-engine v1.0.3 by Josef Jadrny (MIT — see ./LICENSE).
// Only the import path changed (./const/board.mjs -> ./const.js); rest is upstream.
import { COLUMNS, ROWS, COLORS, PIECES } from './const.js';
import type { BoardConfiguration, EnginePiece, EngineSquare } from './const.js';

export function printToConsole(configuration: BoardConfiguration): void {
  process.stdout.write('\n');
  let fieldColor = COLORS.WHITE;
  Object.assign([], ROWS).reverse().map((row: string) => {
    process.stdout.write(`${row}`);
    COLUMNS.map((column) => {
      switch (configuration.pieces[`${column}${row}`]) {
      case 'K': process.stdout.write('♚'); break;
      case 'Q': process.stdout.write('♛'); break;
      case 'R': process.stdout.write('♜'); break;
      case 'B': process.stdout.write('♝'); break;
      case 'N': process.stdout.write('♞'); break;
      case 'P': process.stdout.write('♟'); break;
      case 'k': process.stdout.write('♔'); break;
      case 'q': process.stdout.write('♕'); break;
      case 'r': process.stdout.write('♖'); break;
      case 'b': process.stdout.write('♗'); break;
      case 'n': process.stdout.write('♘'); break;
      case 'p': process.stdout.write('♙'); break;
      default: process.stdout.write(fieldColor === COLORS.WHITE ? '█' : '░');
      }

      fieldColor = fieldColor === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
    });
    fieldColor = fieldColor === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
    process.stdout.write('\n');
  });
  process.stdout.write(' ');
  COLUMNS.map((column) => {
    process.stdout.write(`${column}`);
  });
  process.stdout.write('\n');
}

export function getPieceValue(piece: EnginePiece): number {
  const values: Record<string, number> = { k: 10, q: 9, r: 5, b: 3, n: 3, p: 1 };
  return values[piece.toLowerCase()] || 0;
}

export function getFEN(configuration: BoardConfiguration): string {
  let fen = '';
  Object.assign([], ROWS).reverse().map((row: string) => {
    let emptyFields = 0;
    if (Number(row) < 8) {
      fen += '/';
    }
    COLUMNS.map((column) => {
      const piece = configuration.pieces[`${column}${row}`];
      if (piece) {
        if (emptyFields) {
          fen += emptyFields.toString();
          emptyFields = 0;
        }
        fen += piece;
      } else {
        emptyFields++;
      }
    });
    fen += `${emptyFields || ''}`;
  });

  fen += configuration.turn === COLORS.WHITE ? ' w ' : ' b ';

  const { whiteShort, whiteLong, blackLong, blackShort } = configuration.castling;
  if (!whiteLong && !whiteShort && !blackLong && !blackShort) {
    fen += '-';
  } else {
    if (whiteShort) fen += 'K';
    if (whiteLong) fen += 'Q';
    if (blackShort) fen += 'k';
    if (blackLong) fen += 'q';
  }

  fen += ` ${configuration.enPassant ? configuration.enPassant.toLowerCase() : '-'}`;

  fen += ` ${configuration.halfMove}`;

  fen += ` ${configuration.fullMove}`;

  return fen;
}

export interface ParsedFenConfiguration {
  pieces: Record<EngineSquare, EnginePiece>;
  turn: 'white' | 'black';
  castling: { whiteLong: boolean; whiteShort: boolean; blackLong: boolean; blackShort: boolean };
  enPassant?: EngineSquare;
  halfMove: number;
  fullMove: number;
}

export function getJSONfromFEN(fen: string = ''): ParsedFenConfiguration {
  const [board, player, castlings, enPassant, halfmove, fullmove] = fen.split(' ');

  // pieces
  const configuration: ParsedFenConfiguration = {
    pieces: Object.fromEntries(
      (board ?? '').split('/').flatMap((row, rowIdx) => {
        let colIdx = 0;
        return row.split('').reduce<Array<[string, string]>>((acc, sign) => {
          const piece = sign.match(/k|b|q|n|p|r/i);
          if (piece) {
            acc.push([`${COLUMNS[colIdx]}${ROWS[7 - rowIdx]}`, piece[0]]);
            colIdx += 1;
          }
          const squares = sign.match(/[1-8]/);
          if (squares) {
            colIdx += Number(squares);
          }
          return acc;
        }, []);
      }),
    ),
    turn: 'white',
    castling: { whiteLong: false, whiteShort: false, blackLong: false, blackShort: false },
    halfMove: 0,
    fullMove: 1,
  };

  // playing player
  if (player === 'b') {
    configuration.turn = COLORS.BLACK;
  } else {
    configuration.turn = COLORS.WHITE;
  }

  // castlings
  if (castlings?.includes('K')) {
    configuration.castling.whiteShort = true;
  }
  if (castlings?.includes('k')) {
    configuration.castling.blackShort = true;
  }
  if (castlings?.includes('Q')) {
    configuration.castling.whiteLong = true;
  }
  if (castlings?.includes('q')) {
    configuration.castling.blackLong = true;
  }

  // enPassant
  if (isLocationValid(enPassant)) {
    configuration.enPassant = (enPassant as string).toUpperCase();
  }

  // halfmoves
  configuration.halfMove = parseInt(halfmove ?? '0');

  // fullmoves
  configuration.fullMove = parseInt(fullmove ?? '1');

  return configuration;
}

export function isLocationValid(location: unknown): boolean {
  return typeof location === 'string' && !!location.match('^[a-hA-H]{1}[1-8]{1}$');
}

export function isPieceValid(piece: unknown): boolean {
  return typeof piece === 'string' && (Object.values(PIECES) as string[]).includes(piece);
}
