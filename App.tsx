import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, TouchableHighlight } from "react-native";
import MapView, { MapPressEvent, Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { io, Socket } from "socket.io-client";

const SOCKET_SERVER_URL = "https://server-production-3f37.up.railway.app/"; 
const GOMAPS_API_KEY = "AlzaSyPfDjT_RW9pv01CiQYaKaLabE4PY_Dd0WL"; 

type Coordinate = {
  latitude: number;
  longitude: number;
};

export default function App() {
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [startPoint, setStartPoint] = useState<Coordinate | null>(null);
  const [stopPoint, setStopPoint] = useState<Coordinate | null>(null);
  const [routeCoords, setRouteCoords] = useState<Coordinate[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState(""); // Pour stocker la recherche de destination
  const [suggestions, setSuggestions] = useState<any[]>([]); // Stocke les suggestions d'adresses
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL, { transports: ["websocket"] });

    newSocket.on("connect", () => {
      console.log("✅ Connecté au serveur WebSocket !");
    });

    newSocket.on("connect_error", (err) => {
      console.error("❌ Erreur de connexion WebSocket :", err);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      console.log("❌ Déconnecté du serveur WebSocket");
    };
  }, []);

  const startSharingLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      console.log("❌ Permission de localisation refusée");
      return;
    }

    let loc = await Location.getCurrentPositionAsync({});
    setLocation(loc.coords);
    setStartPoint(loc.coords);
    setIsSharing(true);
    console.log("📡 Début du partage de localisation...");

    intervalRef.current = setInterval(async () => {
      let newLocation = await Location.getCurrentPositionAsync({});
      const newCoords: Coordinate = {
        latitude: newLocation.coords.latitude,
        longitude: newLocation.coords.longitude,
      };
      setLocation(newCoords);
      if (socket) {
        socket.emit("busLocationUpdate", newCoords);
        console.log("📡 Localisation envoyée :", newCoords);
      }
    }, 30000); // ✅ Envoi toutes les 30 secondes
  };

  const stopSharingLocation = () => {
    setIsSharing(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    console.log("🛑 Arrêt du partage de localisation.");
  };

  const handleMapPress = async (event: MapPressEvent) => {
    const newStopPoint = event.nativeEvent.coordinate;
    setStopPoint(newStopPoint);

    if (socket && startPoint) {
      socket.emit("busLocationStart&&StopPoint", { startPoint, stopPoint: newStopPoint });
      console.log("📍 Départ et arrivée envoyés au serveur.");
    }

    if (startPoint) {
      await fetchRouteFromGoMaps(startPoint, newStopPoint);
    }
  };

  const fetchRouteFromGoMaps = async (start: Coordinate, stop: Coordinate) => {
    const url = `https://maps.gomaps.pro/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${stop.latitude},${stop.longitude}&key=${GOMAPS_API_KEY}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const points = data.routes[0].overview_polyline.points;
        const decodedCoords = decodePolyline(points);
        setRouteCoords(decodedCoords);
      } else {
        console.error("❌ Aucune route trouvée :", data);
      }
    } catch (error) {
      console.error("❌ Erreur lors de la récupération de l'itinéraire :", error);
    }
  };

  const fetchSuggestions = async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]); // N'affiche pas de suggestions si la requête est trop courte
      return;
    }

    const url = `https://maps.gomaps.pro/maps/api/place/autocomplete/json?input=${query}&key=${GOMAPS_API_KEY}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      setSuggestions(data.predictions || []);
    } catch (error) {
      console.error("❌ Erreur de recherche d'adresses :", error);
    }
  };

  const selectAddress = (address: any) => {
    // Obtenir les coordonnées pour l'adresse sélectionnée via l'API GoMaps (Geocode)
    const placeId = address.place_id;
    const url = `https://maps.gomaps.pro/maps/api/place/details/json?placeid=${placeId}&key=${GOMAPS_API_KEY}`;

    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        const location = data.result.geometry.location;
        const stopCoord: Coordinate = {
          latitude: location.lat,
          longitude: location.lng,
        };
        setStopPoint(stopCoord);
        setDestinationQuery(address.description);
        setSuggestions([]); // Effacer la liste des suggestions après sélection
        fetchRouteFromGoMaps(startPoint!, stopCoord); // Recalculer l'itinéraire
      })
      .catch((error) => {
        console.error("❌ Erreur lors de la sélection de l'adresse :", error);
      });
  };

  const decodePolyline = (encoded: string) => {
    let points: Coordinate[] = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lng += dlng;

      points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }

    return points;
  };

  return (
    <View style={styles.container}>
     
      
        <MapView 
          initialRegion={{
            latitude: 34.7701248,
            longitude: 10.7675648,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }} 
          style={styles.map}
       
        >
        </MapView>
        
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40, backgroundColor: "#f8f9fa" },
  header: { textAlign: "center", fontSize: 24, fontWeight: "bold", color: "#333", marginBottom: 10 },
  map: { flex: 1, margin: 10, borderRadius: 15 },
  shareButton: {
    backgroundColor: "#007bff",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    alignSelf: "center",
    marginBottom: 15,
    elevation: 5,
  },
  shareButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  searchInput: {
    height: 40,
    borderColor: "#ddd",
    borderWidth: 1,
    borderRadius: 5,
    margin: 10,
    paddingLeft: 10,
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  infoText: {
    textAlign: "center",
    fontSize: 16,
    color: "#555",
    marginTop: 20,
  },
});
