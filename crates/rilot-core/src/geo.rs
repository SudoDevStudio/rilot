//! Geography used for radius eligibility and distance-based latency estimates.
//!
//! The region catalog maps canonical Rilot regions (cloud region ids) to
//! approximate data-center coordinates. It deliberately contains *no* carbon
//! provider identifiers: translating a region into e.g. an Electricity Maps
//! zone is the carbon provider's job, never the core's.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GeoPoint {
    pub lat: f64,
    pub lon: f64,
}

impl GeoPoint {
    /// Parses `"<lat>,<lon>"`, e.g. `"40.71,-74.01"`. Whitespace is ignored.
    /// Returns `None` for anything unparseable or out of range, so a bad
    /// header is simply treated as "location unknown".
    pub fn parse(value: &str) -> Option<GeoPoint> {
        let (lat, lon) = value.split_once(',')?;
        let point = GeoPoint {
            lat: lat.trim().parse().ok()?,
            lon: lon.trim().parse().ok()?,
        };
        point.is_valid().then_some(point)
    }

    pub fn is_valid(&self) -> bool {
        self.lat.is_finite()
            && self.lon.is_finite()
            && (-90.0..=90.0).contains(&self.lat)
            && (-180.0..=180.0).contains(&self.lon)
    }
}

const EARTH_RADIUS_KM: f64 = 6371.0;

/// Great-circle distance in kilometres (haversine).
pub fn distance_km(a: GeoPoint, b: GeoPoint) -> f64 {
    let (lat1, lat2) = (a.lat.to_radians(), b.lat.to_radians());
    let dlat = (b.lat - a.lat).to_radians();
    let dlon = (b.lon - a.lon).to_radians();
    let h = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * h.sqrt().min(1.0).asin()
}

/// Looks up a region in the built-in catalog (case-insensitive).
pub fn region_location(region: &str) -> Option<GeoPoint> {
    let needle = region.trim();
    REGION_CATALOG
        .iter()
        .find(|(id, _, _)| id.eq_ignore_ascii_case(needle))
        .map(|&(_, lat, lon)| GeoPoint { lat, lon })
}

/// All catalog region ids, in catalog order.
pub fn catalog_regions() -> impl Iterator<Item = &'static str> {
    REGION_CATALOG.iter().map(|(id, _, _)| *id)
}

// (region id, latitude, longitude) — approximate metro location of each region.
const REGION_CATALOG: &[(&str, f64, f64)] = &[
    // AWS
    ("us-east-1", 38.95, -77.45),
    ("us-east-2", 39.96, -83.00),
    ("us-west-1", 37.35, -121.96),
    ("us-west-2", 45.84, -119.70),
    ("ca-central-1", 45.50, -73.57),
    ("ca-west-1", 51.05, -114.07),
    ("sa-east-1", -23.55, -46.63),
    ("eu-west-1", 53.35, -6.26),
    ("eu-west-2", 51.51, -0.13),
    ("eu-west-3", 48.86, 2.35),
    ("eu-central-1", 50.11, 8.68),
    ("eu-central-2", 47.37, 8.54),
    ("eu-north-1", 59.33, 18.07),
    ("eu-south-1", 45.46, 9.19),
    ("eu-south-2", 41.65, -0.88),
    ("il-central-1", 32.09, 34.78),
    ("me-south-1", 26.07, 50.56),
    ("me-central-1", 25.20, 55.27),
    ("af-south-1", -33.92, 18.42),
    ("ap-south-1", 19.08, 72.88),
    ("ap-south-2", 17.39, 78.49),
    ("ap-east-1", 22.32, 114.17),
    ("ap-southeast-1", 1.35, 103.82),
    ("ap-southeast-2", -33.87, 151.21),
    ("ap-southeast-3", -6.21, 106.85),
    ("ap-southeast-4", -37.81, 144.96),
    ("ap-northeast-1", 35.68, 139.69),
    ("ap-northeast-2", 37.57, 126.98),
    ("ap-northeast-3", 34.69, 135.50),
    // Google Cloud
    ("us-east1", 33.20, -80.01),
    ("us-east4", 39.04, -77.49),
    ("us-east5", 39.96, -83.00),
    ("us-central1", 41.26, -95.86),
    ("us-south1", 32.78, -96.80),
    ("us-west1", 45.60, -121.18),
    ("us-west2", 34.05, -118.24),
    ("us-west3", 40.76, -111.89),
    ("us-west4", 36.17, -115.14),
    ("northamerica-northeast1", 45.50, -73.57),
    ("northamerica-northeast2", 43.65, -79.38),
    ("southamerica-east1", -23.55, -46.63),
    ("europe-west1", 50.45, 3.82),
    ("europe-west2", 51.51, -0.13),
    ("europe-west3", 50.11, 8.68),
    ("europe-west4", 53.44, 6.84),
    ("europe-west6", 47.37, 8.54),
    ("europe-west9", 48.86, 2.35),
    ("europe-north1", 60.57, 27.19),
    ("europe-central2", 52.23, 21.01),
    ("asia-east1", 24.05, 120.52),
    ("asia-east2", 22.32, 114.17),
    ("asia-northeast1", 35.68, 139.69),
    ("asia-northeast3", 37.57, 126.98),
    ("asia-south1", 19.08, 72.88),
    ("asia-southeast1", 1.35, 103.82),
    ("australia-southeast1", -33.87, 151.21),
    // Azure
    ("eastus", 37.37, -79.82),
    ("eastus2", 36.68, -78.39),
    ("centralus", 41.59, -93.60),
    ("southcentralus", 29.42, -98.49),
    ("westus", 37.78, -122.42),
    ("westus2", 47.23, -119.85),
    ("westus3", 33.45, -112.07),
    ("canadacentral", 43.65, -79.38),
    ("brazilsouth", -23.55, -46.63),
    ("northeurope", 53.35, -6.26),
    ("westeurope", 52.37, 4.90),
    ("uksouth", 51.51, -0.13),
    ("francecentral", 46.30, 2.40),
    ("germanywestcentral", 50.11, 8.68),
    ("swedencentral", 60.67, 17.14),
    ("centralindia", 18.58, 73.92),
    ("southeastasia", 1.35, 103.82),
    ("eastasia", 22.32, 114.17),
    ("japaneast", 35.68, 139.77),
    ("australiaeast", -33.87, 151.21),
    // Generic short names used by examples and the research kit
    ("us-east", 38.95, -77.45),
    ("us-central", 41.26, -95.86),
    ("us-west", 45.84, -119.70),
    ("ca-central", 45.50, -73.57),
    ("sa-east", -23.55, -46.63),
    ("eu-west", 53.35, -6.26),
    ("eu-central", 50.11, 8.68),
    ("eu-north", 59.33, 18.07),
    ("ap-south", 19.08, 72.88),
    ("ap-southeast", 1.35, 103.82),
    ("ap-northeast", 35.68, 139.69),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_entries_are_unique_and_valid() {
        let mut seen = std::collections::HashSet::new();
        for (id, lat, lon) in REGION_CATALOG {
            assert!(
                seen.insert(id.to_ascii_lowercase()),
                "duplicate region {id}"
            );
            assert!(
                GeoPoint {
                    lat: *lat,
                    lon: *lon
                }
                .is_valid(),
                "invalid coords for {id}"
            );
        }
    }

    #[test]
    fn parses_lat_lon_pairs_and_rejects_junk() {
        assert_eq!(
            GeoPoint::parse("40.71,-74.01"),
            Some(GeoPoint {
                lat: 40.71,
                lon: -74.01
            })
        );
        assert_eq!(
            GeoPoint::parse(" 51.5 , -0.13 "),
            Some(GeoPoint {
                lat: 51.5,
                lon: -0.13
            })
        );
        for junk in [
            "",
            "40.71",
            "40.71;-74.01",
            "abc,def",
            "95,0",
            "0,200",
            "40.71,",
        ] {
            assert_eq!(GeoPoint::parse(junk), None, "should reject {junk:?}");
        }
    }

    #[test]
    fn virginia_to_oregon_is_about_3500_km() {
        let d = distance_km(
            region_location("us-east-1").unwrap(),
            region_location("US-WEST-2").unwrap(),
        );
        assert!((3300.0..3700.0).contains(&d), "got {d}");
    }
}
