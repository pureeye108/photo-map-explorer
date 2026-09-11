import unittest
import io
import json
from pathlib import Path
from app import app, photos_db, UPLOAD_DIR

class PhotoMapTestCase(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_01_upload_gps_photo(self):
        with open("test_with_gps.jpg", "rb") as f:
            data = {
                "files": (f, "test_with_gps.jpg")
            }
            res = self.client.post("/api/upload", data=data, content_type="multipart/form-data")
        self.assertEqual(res.status_code, 200)
        json_data = res.get_json()
        self.assertEqual(json_data["processed"], 1)
        photo = json_data["photos"][0]

        print("\n--- GPS Photo Upload Result ---")
        print("Latitude:", photo["latitude"])
        print("Longitude:", photo["longitude"])
        print("Camera:", photo["camera_make"], photo["camera_model"])
        print("Lens:", photo["lens"])
        print("Location source:", photo["location_source"])

        self.assertAlmostEqual(photo["latitude"], 48.8584, delta=0.01)
        self.assertAlmostEqual(photo["longitude"], 2.2945, delta=0.01)
        self.assertEqual(photo["location_source"], "gps")
        self.assertEqual(photo["camera_make"], "Sony")
        self.assertEqual(photo["camera_model"], "ILCE-7RM4")

    def test_02_upload_no_gps_photo(self):
        with open("test_no_gps.jpg", "rb") as f:
            data = {
                "files": (f, "test_no_gps.jpg")
            }
            res = self.client.post("/api/upload", data=data, content_type="multipart/form-data")
        self.assertEqual(res.status_code, 200)
        json_data = res.get_json()
        photo = json_data["photos"][0]

        print("\n--- No-GPS Photo Upload Result ---")
        print("Latitude:", photo["latitude"])
        print("Longitude:", photo["longitude"])
        print("Location source:", photo["location_source"])
        print("Warning:", photo["warning"])

        self.assertIsNone(photo["latitude"])
        self.assertIsNone(photo["longitude"])
        self.assertEqual(photo["location_source"], "none")
        self.assertIn("No GPS metadata", photo["warning"])

    def test_03_manual_placement(self):
        # Pick one unlocated photo and place it manually
        res = self.client.get("/api/photos")
        photos = res.get_json()
        unlocated = [p for p in photos if p["latitude"] is None]
        self.assertTrue(len(unlocated) > 0)
        target_id = unlocated[0]["id"]

        update_res = self.client.post("/api/update-location", json={
            "photo_id": target_id,
            "latitude": 40.7128,
            "longitude": -74.0060
        })
        self.assertEqual(update_res.status_code, 200)
        data = update_res.get_json()
        self.assertEqual(data["photo"]["location_source"], "manual")
        self.assertAlmostEqual(data["photo"]["latitude"], 40.7128)
        self.assertAlmostEqual(data["photo"]["longitude"], -74.0060)
        print("\n--- Manual Placement Result ---")
        print("Updated location:", data["photo"]["latitude"], data["photo"]["longitude"], data["photo"]["location_source"])

    def test_04_export_geojson(self):
        res = self.client.get("/api/export/geojson")
        self.assertEqual(res.status_code, 200)
        geojson = res.get_json()
        self.assertEqual(geojson["type"], "FeatureCollection")
        self.assertTrue(len(geojson["features"]) >= 2)
        print("\n--- GeoJSON Export Result ---")
        print(f"Exported {len(geojson['features'])} mapped features.")

if __name__ == "__main__":
    unittest.main()
