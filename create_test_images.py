import io
import json
from PIL import Image
import piexif
import requests

def create_test_images():
    # 1. Create Image with EXIF GPS (Paris, Eiffel Tower: 48.8584 N, 2.2945 E)
    img_gps = Image.new("RGB", (400, 300), color=(70, 130, 180))
    
    # 48 deg 51 min 30.24 sec N
    # 2 deg 17 min 40.20 sec E
    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef: 'N',
        piexif.GPSIFD.GPSLatitude: ((48, 1), (51, 1), (3024, 100)),
        piexif.GPSIFD.GPSLongitudeRef: 'E',
        piexif.GPSIFD.GPSLongitude: ((2, 1), (17, 1), (4020, 100)),
        piexif.GPSIFD.GPSAltitude: (35, 1)
    }
    
    exif_dict = {
        "0th": {
            piexif.ImageIFD.Make: "Sony",
            piexif.ImageIFD.Model: "ILCE-7RM4",
            piexif.ImageIFD.DateTime: "2024:06:15 14:32:00"
        },
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: "2024:06:15 14:32:00",
            piexif.ExifIFD.FNumber: (28, 10),
            piexif.ExifIFD.ExposureTime: (1, 500),
            piexif.ExifIFD.ISOSpeedRatings: 100,
            piexif.ExifIFD.FocalLength: (50, 1),
            piexif.ExifIFD.LensModel: "FE 50mm F1.4 GM"
        },
        "GPS": gps_ifd
    }
    exif_bytes = piexif.dump(exif_dict)
    img_gps.save("test_with_gps.jpg", "jpeg", exif=exif_bytes)

    # 2. Create Image without GPS (simulates photo needing landmark detection)
    img_no_gps = Image.new("RGB", (400, 300), color=(220, 100, 80))
    img_no_gps.save("test_no_gps.jpg", "jpeg")
    print("Test images created: test_with_gps.jpg, test_no_gps.jpg")

if __name__ == "__main__":
    create_test_images()
