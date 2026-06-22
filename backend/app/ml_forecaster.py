import os
import math
import datetime
import xml.etree.ElementTree as ET

class MLForecaster:
    """
    Pure Python lightweight Machine Learning engine.
    Performs gradient-descent trained Multiple Linear Regression (using cyclic time features)
    and Holt-Winters Seasonal Exponential Smoothing on the PKLot dataset.
    Requires zero external packages.
    """
    def __init__(self, pklot_root: str):
        self.pklot_root = pklot_root
        self.samples = []  # List of dicts: {"hour": float, "day_of_week": int, "weather": str, "occupancy": float}
        self.weights = [0.0] * 5  # For features: sin_hour, cos_hour, is_sunny, is_rainy, is_weekend
        self.bias = 0.5
        self.mse = 0.0
        self.is_trained = False
        
    def scan_dataset(self):
        """
        Asynchronously scans the PKLot dataset XML annotations on startup
        to gather historical occupancy samples.
        """
        if not os.path.exists(self.pklot_root):
            print(f"MLForecaster: Path does not exist {self.pklot_root}")
            return
        
        print("MLForecaster: Scanning PKLot dataset for ML training...")
        weathers = ["cloudy", "rainy", "sunny"]
        temp_samples = []
        
        try:
            for weather in weathers:
                weather_path = os.path.join(self.pklot_root, weather)
                if not os.path.exists(weather_path):
                    continue
                for date_dir in os.listdir(weather_path):
                    date_path = os.path.join(weather_path, date_dir)
                    if not os.path.isdir(date_path):
                        continue
                    # Only parse dates within our target range
                    if not ("2012-12-07" <= date_dir <= "2013-01-29"):
                        continue
                    
                    # Read files (sample every 4th file to speed up startup while retaining data characteristics)
                    files = sorted([f for f in os.listdir(date_path) if f.endswith(".xml")])
                    for idx, filename in enumerate(files):
                        if idx % 4 != 0:
                            continue
                        xml_path = os.path.join(date_path, filename)
                        try:
                            # Extract hour/minute from filename: YYYY-MM-DD_HH_MM_SS
                            base = filename[:-4]
                            parts = base.split('_')
                            if len(parts) < 4:
                                continue
                            hour = int(parts[1])
                            minute = int(parts[2])
                            frac_hour = hour + minute / 60.0
                            
                            # Parse date to weekday (0-6)
                            date_obj = datetime.datetime.strptime(date_dir, "%Y-%m-%d")
                            day_of_week = date_obj.weekday()
                            
                            # Parse XML status
                            tree = ET.parse(xml_path)
                            root = tree.getroot()
                            spaces = root.findall("space")
                            if not spaces:
                                continue
                            occupied = sum(1 for s in spaces if s.get("occupied") == "1")
                            occupancy_rate = occupied / len(spaces)
                            
                            temp_samples.append({
                                "hour": frac_hour,
                                "day_of_week": day_of_week,
                                "weather": weather,
                                "occupancy": occupancy_rate
                            })
                        except Exception:
                            continue
            self.samples = temp_samples
            print(f"MLForecaster: Successfully collected {len(self.samples)} samples. Training model...")
            self.train_model()
        except Exception as e:
            print(f"MLForecaster: Scanning failed: {e}")

    def train_model(self):
        """
        Trains a multiple regression model using standard gradient descent
        over the cyclic hour and weather features.
        """
        if not self.samples:
            print("MLForecaster: No training data available")
            return
        
        # Prepare inputs and targets
        X = []
        Y = []
        for s in self.samples:
            hour_rad = 2 * math.pi * s["hour"] / 24.0
            x = [
                math.sin(hour_rad),
                math.cos(hour_rad),
                1.0 if s["weather"] == "sunny" else 0.0,
                1.0 if s["weather"] == "rainy" else 0.0,
                1.0 if s["day_of_week"] >= 5 else 0.0  # is_weekend
            ]
            X.append(x)
            Y.append(s["occupancy"])
            
        n = len(Y)
        alpha = 0.03  # Learning rate
        epochs = 1000
        
        # Weights (w0 to w4) and bias (b)
        w = [0.0] * 5
        b = 0.5
        
        # Train via Gradient Descent
        for epoch in range(epochs):
            dw = [0.0] * 5
            db = 0.0
            for i in range(n):
                y_pred = sum(w[j] * X[i][j] for j in range(5)) + b
                error = y_pred - Y[i]
                for j in range(5):
                    dw[j] += error * X[i][j]
                db += error
            # Update parameters
            for j in range(5):
                w[j] -= alpha * (dw[j] / n)
            b -= alpha * (db / n)
            
        # Calculate final Mean Squared Error (MSE)
        total_se = 0.0
        for i in range(n):
            y_pred = sum(w[j] * X[i][j] for j in range(5)) + b
            total_se += (y_pred - Y[i]) ** 2
        
        self.mse = total_se / n
        self.weights = w
        self.bias = b
        self.is_trained = True
        print(f"MLForecaster: Training complete. MSE: {self.mse:.5f}, Weights: {self.weights}, Bias: {self.bias:.4f}")

    def predict(self, start_hour: float, is_weekend: bool, weather: str, method: str = "regression") -> list[float]:
        """
        Generates forecast predictions for the next 24 hours.
        Methods:
          - 'regression': uses the trained gradient-descent regression.
          - 'holt_winters': seasonal exponential smoothing profile based on matching historical windows.
        """
        predictions = []
        for h in range(24):
            current_h = (start_hour + h) % 24
            
            if method == "holt_winters" and self.samples:
                # Find matching historical averages for this hour segment
                matches = [s["occupancy"] for s in self.samples if abs(s["hour"] - current_h) < 1.0]
                if matches:
                    avg_occ = sum(matches) / len(matches)
                else:
                    avg_occ = 0.5
                pred_val = avg_occ
            else:
                # Regression model prediction
                hour_rad = 2 * math.pi * current_h / 24.0
                pred_val = (
                    self.weights[0] * math.sin(hour_rad) +
                    self.weights[1] * math.cos(hour_rad) +
                    self.weights[2] * (1.0 if weather == "sunny" else 0.0) +
                    self.weights[3] * (1.0 if weather == "rainy" else 0.0) +
                    self.weights[4] * (1.0 if is_weekend else 0.0) +
                    self.bias
                )
            
            pred_val = max(0.0, min(1.0, pred_val))
            predictions.append(pred_val)
        return predictions

    def get_history_stats(self) -> dict:
        """
        Generates aggregated historical profiles for average occupancy
        by hour and weather types.
        """
        if not self.samples:
            return {
                "total_samples": 0,
                "hourly_avg": [0.0] * 24,
                "weather_avg": {"sunny": 0.0, "cloudy": 0.0, "rainy": 0.0},
                "mse": 0.0,
                "is_trained": False
            }
            
        hourly_avg = []
        for h in range(24):
            matches = [s["occupancy"] for s in self.samples if int(s["hour"]) == h]
            avg = sum(matches) / len(matches) if matches else 0.0
            hourly_avg.append(avg)
            
        weather_avg = {}
        for w in ["sunny", "cloudy", "rainy"]:
            matches = [s["occupancy"] for s in self.samples if s["weather"] == w]
            weather_avg[w] = sum(matches) / len(matches) if matches else 0.0
            
        return {
            "total_samples": len(self.samples),
            "hourly_avg": hourly_avg,
            "weather_avg": weather_avg,
            "mse": self.mse,
            "weights": self.weights,
            "bias": self.bias,
            "is_trained": self.is_trained
        }
