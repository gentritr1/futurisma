"""Zero-padded 2-D white-mask autocorrelation; largest *local* secondary peak.
Adjacent lags in the zero-lag lobe are not secondary peaks. A peak must exceed
at least one of its eight neighbours; flat zero regions are not peaks.
"""
import numpy as np

def autocorrelation_peak(mask):
    h,w=mask.shape
    if not mask.any(): return 0.0
    spectrum=np.fft.rfft2(mask.astype(float),s=(2*h,2*w))
    correlation=np.fft.fftshift(np.fft.irfft2(abs(spectrum)**2,s=(2*h,2*w)))
    correlation/=correlation[h,w]
    neighbours=[np.roll(correlation,(y,x),(0,1)) for y in (-1,0,1) for x in (-1,0,1) if x or y]
    peaks=np.logical_and.reduce([correlation>=n-1e-10 for n in neighbours])
    peaks &= np.logical_or.reduce([correlation>n+1e-10 for n in neighbours])
    peaks[h,w]=False
    return float(max(0,correlation[peaks].max(initial=0)))
