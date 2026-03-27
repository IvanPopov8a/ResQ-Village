import pandas as pd
import xgboost as xgb
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

# 1. Load data
df = pd.read_csv('bulgaria_real_test_history.csv')
X = df.drop('label', axis=1)
y = df['label']

# 2. Split (Stratified to keep positive class percentage consistent)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# 3. Setup tracking for the best model
weight_values = [48, 50.0, 51, 51.5, 52, 60.0]
results = []
best_f1 = -1.0
best_model = None
best_weight = None

print(" Testing different scale_pos_weight values...\n")

for weight in weight_values:
    print(f"Training with scale_pos_weight = {weight}...")
    
    model = xgb.XGBClassifier(
        n_estimators=1000,
        learning_rate=0.05,
        max_depth=6,
        colsample_bytree=0.8,
        random_state=42,
        eval_metric='aucpr',
        scale_pos_weight=weight,
        n_jobs=-1
    )
    
    model.fit(X_train, y_train)
    
    # Predict and calculate metrics
    y_pred = model.predict(X_test)
    tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, y_pred, average='binary')
    
    # Store results
    results.append({
        'weight': weight,
        'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn,
        'recall': recall, 'precision': precision, 'f1': f1
    })

    # Update Best Model tracking
    if f1 > best_f1:
        best_f1 = f1
        best_model = model
        best_weight = weight
    
    print(f"   TP: {tp} | FP: {fp} | FN: {fn} | TN: {tn}")
    print(f"   F1: {f1:.4f}\n")

# 4. Show summary table with 4 decimal places
summary = pd.DataFrame(results)
print("=== SUMMARY TABLE ===")
print(summary.round(4))

# 5. Save the winner
if best_model is not None:
    model_name = f'best_fire_model_weight_{best_weight}.joblib'
    joblib.dump(best_model, model_name)
    print(f"\nBEST MODEL SAVED: {model_name}")
    print(f"Targeting Weight: {best_weight} with F1-Score: {best_f1:.4f}")