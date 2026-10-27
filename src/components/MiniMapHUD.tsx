import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MiniMapHUDProps {
  x: number;
  z: number;
  heading: number;
}

const WORLD_RADIUS = 100;

export const MiniMapHUD: React.FC<MiniMapHUDProps> = ({ x, z, heading }) => {
  const { width } = useWindowDimensions();
  const mapSize = width < 370 ? 106 : 122;
  const playerLeft = `${Math.max(4, Math.min(96, ((x + WORLD_RADIUS) / (WORLD_RADIUS * 2)) * 100))}%` as `${number}%`;
  const playerTop = `${Math.max(4, Math.min(96, ((z + WORLD_RADIUS) / (WORLD_RADIUS * 2)) * 100))}%` as `${number}%`;

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={[styles.map, { width: mapSize, height: mapSize, borderRadius: mapSize / 2 }]}>
        <View style={styles.waterline} />
        {[15, 32, 49, 66, 83].map((offset) => (
          <React.Fragment key={offset}>
            <View style={[styles.road, styles.verticalRoad, { left: `${offset}%` as `${number}%` }]} />
            <View style={[styles.road, styles.horizontalRoad, { top: `${offset}%` as `${number}%` }]} />
          </React.Fragment>
        ))}
        <View style={[styles.park, { left: '24%', top: '35%' }]} />
        <View style={[styles.playerMarker, { left: playerLeft, top: playerTop }]}>
          <View style={[styles.playerArrow, { transform: [{ rotate: `${Math.PI - heading}rad` }] }]}>
            <Ionicons name="navigate" size={16} color="#f5d58f" />
          </View>
          <View style={styles.playerDot} />
        </View>
        <Text style={styles.north}>N</Text>
      </View>
      <View style={styles.captionRow}>
        <View style={styles.liveDot} />
        <Text style={styles.caption}>BENTOWN  ·  GPS</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 18,
    alignItems: 'center',
  },
  map: {
    overflow: 'hidden',
    backgroundColor: 'rgba(13, 29, 28, 0.88)',
    borderWidth: 1.5,
    borderColor: 'rgba(243,236,216,0.82)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 7,
  },
  waterline: {
    position: 'absolute',
    right: 0,
    width: '18%',
    height: '100%',
    backgroundColor: 'rgba(88, 137, 151, 0.48)',
  },
  road: {
    position: 'absolute',
    backgroundColor: 'rgba(235, 226, 197, 0.78)',
  },
  verticalRoad: {
    top: 0,
    bottom: 0,
    width: 2,
  },
  horizontalRoad: {
    left: 0,
    right: 0,
    height: 2,
  },
  park: {
    position: 'absolute',
    width: '19%',
    height: '23%',
    borderRadius: 6,
    backgroundColor: 'rgba(93, 126, 87, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(227,222,189,0.46)',
  },
  playerMarker: {
    position: 'absolute',
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -9,
    marginTop: -9,
  },
  playerArrow: {
    position: 'absolute',
    top: -7,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#fff9e8',
    borderWidth: 1,
    borderColor: '#344741',
  },
  north: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    color: 'rgba(248,245,233,0.9)',
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'center',
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(13,29,28,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(243,236,216,0.28)',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#85c58a',
    marginRight: 6,
  },
  caption: {
    color: 'rgba(248,245,233,0.9)',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
});
