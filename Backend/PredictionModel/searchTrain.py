import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.metrics import classification_report, f1_score

# =========================

# 1. LOAD DATA

# =========================

df = pd.read_csv('bulgaria_real_test_history.csv')

X = df.drop('label', axis=1)
y = df['label']

# =========================

# 2. TRAIN / TEST SPLIT (80/20)

# =========================

X_train, X_test, y_train, y_test = train_test_split(
X, y,
test_size=0.2,
random_state=42,
stratify=y   # IMPORTANT for imbalanced data
)

# =========================

# 3. PARAMETER GRID

# =========================

param_grid = {
'max_depth': [6, 8, 10],
'learning_rate': [0.01, 0.05],
'gamma': [0, 0.1, 0.2],
'n_estimators': [500, 1000],
'scale_pos_weight': [18, 20, 24]
}

# =========================

# 4. BASE MODEL

# =========================

base_model = xgb.XGBClassifier(
eval_metric='aucpr',
random_state=42,
tree_method='hist'
)

# =========================

# 5. GRID SEARCH (ONLY TRAIN DATA)

# =========================

print("🔍 Running Grid Search...")

grid_search = GridSearchCV(
estimator=base_model,
param_grid=param_grid,
scoring='f1',
cv=3,
verbose=1,
n_jobs=-1
)

grid_search.fit(X_train, y_train)

# =========================

# 6. BEST PARAMETERS

# =========================

print("\n🏆 BEST PARAMETERS FOUND:")
print(grid_search.best_params_)
print(f"Best CV F1 Score: {grid_search.best_score_:.4f}")

best_model = grid_search.best_estimator_

# =========================

# 8. SAVE MODEL

# =========================

best_model.save_model("resq_village_v2_optimized.json")
print("\n🚀 Model saved as resq_village_v2_optimized.json")
