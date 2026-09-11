/** Exit after the selected instrument has completed all work and browser cleanup. */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
try{await import(pathToFileURL(resolve(process.argv[2])).href);process.exit(0);}
catch(error){console.error(error);process.exit(1);}
