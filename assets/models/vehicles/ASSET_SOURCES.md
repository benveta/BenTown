# Vehicle model sources

These five unbranded vehicle GLBs were downloaded from the Innerscene 3D Parts Library. Each source page labels its downloadable asset CC0.

| File | Source |
| --- | --- |
| `sedan.glb` | [Sedan car](https://www.innerscene.com/tools/library/3d-parts/sedan-car-42109739) |
| `suv.glb` | [SUV](https://www.innerscene.com/tools/library/3d-parts/suv-dc972cab) |
| `delivery-van.glb` | [Delivery van](https://www.innerscene.com/tools/library/3d-parts/delivery-van-131990b3) |
| `pickup.glb` | [Pickup truck](https://www.innerscene.com/tools/library/3d-parts/pickup-truck-da45aa3f) |
| `city-bus.glb` | [Low-floor city bus](https://www.innerscene.com/tools/library/3d-parts/low-floor-city-bus-9e7ce899) |

The GLBs are embedded in `src/assets/vehicleModelsBase64.ts` so Metro can bundle and load them at runtime without filesystem or remote-fetch dependencies.
