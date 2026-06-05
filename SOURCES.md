# Data sources

Meridian draws only on official, public, free, and legal feeds. Each source maps
to exactly one domain, carries a static reliability weight that feeds the
confidence score (confidence = reliability x recency), and is recorded per object
so provenance travels with the data.

This file lists the layers live today. More official sources are being added in
waves; this list grows with them.

## Live feeds

| Source | Domain | Provider | Reliability | Endpoint | Terms |
|---|---|---|---|---|---|
| USGS earthquakes | seismic | U.S. Geological Survey | 0.98 | earthquake.usgs.gov | U.S. government, public domain |
| USGS significant (M4.5+, 30d) | seismic | U.S. Geological Survey | 0.98 | earthquake.usgs.gov | U.S. government, public domain |
| NWS alerts | environmental | NOAA / National Weather Service | 0.97 | weather.gov | U.S. government, public domain |
| CAP Alert Hub (global) | environmental | IFRC Alert Hub (CAP aggregator) | 0.90 | alerthub.ifrc.org | Aggregated official CAP, public |
| NHC cyclones | environmental | NOAA / National Hurricane Center | 0.97 | nhc.noaa.gov | U.S. government, public domain |
| NIFC wildfire | environmental | National Interagency Fire Center | 0.95 | nifc.gov | U.S. government, public domain |
| NASA EONET | environmental | NASA Earth Observatory | 0.95 | eonet.gsfc.nasa.gov | NASA open data |
| NASA FIRMS fires | environmental | NASA FIRMS (MODIS/VIIRS) | 0.80 | firms.modaps.eosdis.nasa.gov | NASA open data, API key |
| GDACS disasters | disaster | Global Disaster Alert and Coordination System | 0.95 | gdacs.org | Public, attribution |
| CNEOS fireballs | space | NASA JPL Center for Near-Earth Object Studies | 0.95 | cneos.jpl.nasa.gov | NASA open data |
| Launch Library | space | The Space Devs | 0.90 | thespacedevs.com/llapi | Public API, attribution |
| ADS-B aircraft | aviation | airplanes.live | 0.85 | airplanes.live | Public, non-commercial use |
| Digitraffic AIS | maritime | Fintraffic (Finnish Transport) | 0.85 | digitraffic.fi | CC BY 4.0 |

## Notes

* Reliability is a static per-source prior, not a live quality measurement. It sets the ceiling of an object's confidence; recency decays it from there.
* U.S. federal feeds (USGS, NWS, NHC, NIFC, NASA, JPL) are public-domain works of the U.S. government.
* Several feeds are licensed for non-commercial use or require attribution. Meridian honors each source's license and records the source on every object so attribution is preserved end to end.
* Aircraft and vessel positions are official, public, aggregate transponder broadcasts (ADS-B, AIS). Meridian resolves them by ICAO hex and MMSI as transport entities. It does not identify, profile, or track named private individuals.
* The CAP Alert Hub layer keeps only alerts that carry a real CAP polygon or circle, so each dot sits on the warned area rather than a country centroid. US alerts are dropped because NWS already ingests them with geometry. The high-volume feeds (CAP Alert Hub, FIRMS, USGS significant) run on the hourly cycle, not every 15 minutes, to stay inside the free-tier write budget.

## Scope

Meridian ingests official, public, aggregate sources only. It does not scan or
probe infrastructure it does not own, ingest scanner audio, perform facial
recognition, or collect license-plate or personal-social-media data. A source
that cannot be cited and licensed does not belong in Meridian.
