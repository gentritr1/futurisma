"""Compatibility entry point for the unified painted Tideline environment."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('build_tideline.py')),run_name='__main__')
