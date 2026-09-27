#!/bin/sh
# Подложка карты для работы без интернета: из экстракта OpenStreetMap собирается
# срез Москвы в pmtiles. Готовые срезы Protomaps с рабочей машины не качаются —
# канал до них режется, поэтому подложка собирается локально.
#
#   sh tools/basemap.sh            полный проход, включая выкачку экстракта
#
# Нужны osmium-tool и tippecanoe (brew install osmium-tool tippecanoe).
set -e
DIR=data/basemap
BBOX=37.2,55.50,38.0,55.95
OUT=web/public/tiles/moscow.pmtiles

mkdir -p "$DIR" "$(dirname "$OUT")"
if [ ! -f "$DIR/central.osm.pbf" ]; then
  curl -L --retry 8 --retry-all-errors -C - \
    -o "$DIR/central.osm.pbf" \
    https://download.geofabrik.de/russia/central-fed-district-latest.osm.pbf
fi

osmium extract -b "$BBOX" "$DIR/central.osm.pbf" -o "$DIR/moscow.osm.pbf" --overwrite

osmium tags-filter -o "$DIR/water.pbf" --overwrite "$DIR/moscow.osm.pbf" \
  w/natural=water w/waterway=riverbank r/natural=water w/landuse=reservoir
osmium tags-filter -o "$DIR/green.pbf" --overwrite "$DIR/moscow.osm.pbf" \
  w/leisure=park w/landuse=forest,grass,cemetery,recreation_ground w/natural=wood
osmium tags-filter -o "$DIR/roads.pbf" --overwrite "$DIR/moscow.osm.pbf" \
  w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,residential,unclassified
osmium tags-filter -o "$DIR/rail.pbf" --overwrite "$DIR/moscow.osm.pbf" \
  w/railway=rail,subway,tram

for l in water green roads rail; do
  osmium export -f geojsonseq -o "$DIR/$l.geojsons" --overwrite "$DIR/$l.pbf"
done

# Подписей в подложке нет намеренно: без них не нужен набор глифов в образе,
# а названия улиц диспетчеру не нужны — ориентир даёт трасса маршрута.
tippecanoe -o "$OUT" --force -Z6 -z14 -y highway -y railway \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -L water:"$DIR/water.geojsons" \
  -L green:"$DIR/green.geojsons" \
  -L roads:"$DIR/roads.geojsons" \
  -L rail:"$DIR/rail.geojsons"

echo "подложка: $OUT"
