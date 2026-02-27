vehicle<-read.csv('../Data/vehicles.csv')

library(earth)
library(caret)
library(e1071)
library(kernlab)
library(corrplot)
library(elasticnet)
library(glmnet)


View(vehicle)
names(vehicle)
#Sample 5000 accounts and drop non-predictive data
dataSet = sample(nrow(vehicle), 5000)
df2=vehicle[dataSet,-c(1:4,8,15,20:25)]
names(df2)
head(df2)
write.csv(df2,"vehicle1.csv")
vehicle1<-read.csv('vehicle1.csv')
dim(vehicle1)
####Before Preprocessing
hist(vehicle1$odometer)
hist(vehicle1$price)
hist(vehicle1$year, main ="Distribution of Year", xlab = "Year")
boxplot(vehicle1$odometer, main="Odometer")
boxplot(vehicle1$price,main="Price")
skewness(vehicle1[vehicle1$odometer == "NA",])
skewness(vehicle1$price)


####



####Preprocess
price<-vehicle1$price
names(vehicle1)
pvehicle<-vehicle1[,-c(1:2)]

set.seed(1)
sampleData = vehicle1[sample(nrow(vehicle1),500), ]
plot(odometer~year, data = sampleData,
     ylab = "Odometer", xlab = "Year", col = 12,
     main = "Odometer vs. Year")
sd.mod = lm(odometer~year, data=sampleData)
abline(sd.mod, col = "red")
summary(sd.mod)


head(pvehicle)
nzv = nearZeroVar(pvehicle);nzv
dc =dummyVars(~.,data=pvehicle,fullRank = TRUE)
veh=predict(dc,pvehicle); veh
typeof(veh)
pp <- preProcess(veh,method=c("nzv", "BoxCox", "center","scale","knnImpute","pca","spatialSign")) ## need {caret} package
veh=predict(pp,veh)
names(as.data.frame(veh))
head(veh, 2)

pcaObject = prcomp(veh, center = TRUE, scale =TRUE)
perVar = (pcaObject$sdev)^2/sum((pcaObject$sdev)^2)*100;perVar

#Scree Plot
x = 1:length(perVar)
plot(perVar~x, type = 'l', main = "Scree Plot", 
     ylab = "Percent of Total Variance", xlab = "Component")

#veh = veh[,-c(37:57)] #Only do this once!!!
ncol(veh)
corrplot(cor(veh), labels = FALSE)


tooHigh = findCorrelation(cor(veh), cutoff = 0.75);tooHigh
#veh = veh[,-tooHigh] #Also just once!!!

corrplot(cor(veh), labels = FALSE)


names(as.data.frame(veh))


skewValues = sapply(as.data.frame(veh), skewness);skewValues
min(skewValues)
max(skewValues)

boxplot(veh[,1])
boxplot(veh[,2])
boxplot(veh[,3])
boxplot(veh[,4])
boxplot(veh[,5])
boxplot(veh[,6]) #Condition Excellent
boxplot(veh[,7])
boxplot(veh[,8])
boxplot(veh[,9])
boxplot(veh[,10])
boxplot(veh[,11])
boxplot(veh[,12])
boxplot(veh[,13]) #Odometer
boxplot(veh[,14])
boxplot(veh[,15])
boxplot(veh[,16]) #4wd
boxplot(veh[,17]) #fwd
boxplot(veh[,18])
boxplot(veh[,19])
boxplot(veh[,20])
boxplot(veh[,21])
boxplot(veh[,22])
boxplot(veh[,23])
boxplot(veh[,24])
boxplot(veh[,25])
boxplot(veh[,26])
boxplot(veh[,27])
boxplot(veh[,28])
boxplot(veh[,29])
boxplot(veh[,30])
boxplot(veh[,31])
boxplot(veh[,32])
boxplot(veh[,33])
boxplot(veh[,34])
boxplot(veh[,35])
boxplot(veh[,36])
boxplot(veh[,37])

names(as.data.frame(veh))
hist(as.data.frame(veh)$year, col = 12, 
     main = "Year After Pre-Processing",
     xlab = "Year (Transformed)")
hist(as.data.frame(veh)$odometer, col = 12, 
     main = "Odometer After Pre-Processing",
     xlab = "Odometer (Transformed)")
as.data.frame(veh)

set.seed(1)
train2 <- createDataPartition(price,  p = .80,  list= FALSE)
ptrain <- veh[train2,]
ytrain<-price[train2]
ptest <- veh[-train2,]
ytest<-price[-train2]

#Resampling strategy used thruought 
ctrl<-trainControl(method="cv", number=10)

####linear
set.seed(1)
lmod<-train(ptrain,ytrain,method="lm",trControl=ctrl, 
            tuneLength = 10)
lmod
lm.res = residuals(lmod)
plot(lm.res~fitted(lmod), ylim = c(-10000,10000))
#lmod_pred<-predict(lmod,ptest)
#postResample(pred=lmod_pred,obs=ytest)

#####ridge
set.seed(1)
ridgeGrid <- data.frame(.lambda = seq(0, .9, length = 18))
ridgeRegFit <- train(ptrain, ytrain, method = "ridge", 
                     tuneGrid = ridgeGrid, trControl = ctrl)
rid_pred<-predict(ridgeRegFit,ptest)
postResample(pred=rid_pred,obs=ytest)
ridgeRegFit
plot(ridgeRegFit)

#####lasso
set.seed(1)
lass<-train(ptrain,ytrain,method="lasso",trControl=ctrl)
lass
plot(lass)
lass_pred<-predict(lass,ptest)
postResample(pred=lass_pred,obs=ytest)

####elastic net
set.seed(1)
enetGrid <- expand.grid(.lambda = c(0, 0.01, .1), .alpha = seq(0.1, 1, length = 10))
elas<-train(ptrain,ytrain,method="glmnet",trControl=ctrl)
elas
plot(elas)
elas_pred<-predict(elas,ptest)
postResample(pred=elas_pred,obs=ytest)
ptrain[1:4,]


######################
####Neural Network
set.seed(1)
nnetGrid <- expand.grid(.decay = c(0, 0.01, .1),
                        .size = c(1:10),
                        ## The next option is to use bagging (see the
                        ## next chapter) instead of different random
                        ## seeds.
                        .bag = FALSE)

nnetTune <- train(ptrain, ytrain,
                  method = "avNNet",
                  tuneGrid = nnetGrid,
                  trControl = ctrl,
                  ## Automatically standardize data prior to modeling
                  ## and prediction
                  preProc = c("center", "scale"),
                  linout = TRUE,
                  trace = FALSE,
                  MaxNWts = 10 * (ncol(ptrain) + 1) + 10 + 1,
                  maxit = 500)
nnetTune

nnet_pred<-predict(nnetTune,ptest)
postResample(pred=nnet_pred,obs=ytest)

plot(ytest~nnet_pred, xlab = "Predicted", ylab = "Actual", ylim = c(0,80000))
length(nnet_pred)
plot(ptest~nnet_pred)

#### Plots for Neural Network Model ###
#RMSE~Cost
plot(nnetTune)


nnet_Model = lm(ytest~nnet_pred)
#diagnostics
plot(nnet_Model, col = 4)
#Actual~Predicted
plot(ytest~fitted(nnet_Model), xlab = "Predicted", ylab = "Actual", col = "blue",
     main = "Neural Network Model", ylim=c(0,90000), xlim = c(5000,80000))
abline(nnet_Model, col = "red")

#Res~Fit for Actual~Predicted
marsRes = rstandard(mars_Model)
plot(marsRes~fitted(mars_Model), ylab = "Residuals", xlab = "Fitted Values", 
     main = "MARS", col = 10, xlim = c(0,80000))

#Ordered Observations~Model
x = 1:length(ytest)
plot(x, ytest, pch=18, col=4, xlab ="", ylab = "", ylim=c(0,90000), main = "MARS Model Fit")
lines(x, mars_pred, lwd="1", col="red")
####
####################################################
####
####






####
#MARS Model


set.seed(1)
marsGrid <- expand.grid(.degree = 1:4, .nprune = 2:50)

marsTuned <- train(ptrain, ytrain,
                   method = "earth",
                   tuneGrid = marsGrid,
                   trControl = trainControl(method = "cv"))
marsTuned
marsTuned$bestTune
mars_pred<-predict(marsTuned,ptest)
postResample(pred=mars_pred,obs=ytest)

#### Plots for MARS Model ###
#RMSE~Cost
plot(marsTuned)


mars_Model = lm(ytest~mars_pred)
#diagnostics
plot(mars_Model, col = 4)
#Actual~Predicted
plot(mars_pred~ytest, xlab = "Predicted", ylab = "Actual", col = "blue",
     main = "MARS Model", ylim=c(0,90000), xlim = c(0,50000))
abline(mars_Model, col = "red")

#Res~Fit for Actual~Predicted
marsRes = rstandard(mars_Model)
plot(marsRes~fitted(mars_Model), ylab = "Residuals", xlab = "Fitted Values", 
     main = "MARS", col = 10, xlim = c(0,40000))

#Ordered Observations~Model
x = 1:length(ytest)
plot(x, ytest, col=12, xlab ="", ylab = "", ylim=c(0,90000), main = "MARS Model Fit")
lines(x, mars_pred, lwd="1", col="red")
####
####################################################
####
####


###################################
# SVM Model Radial Basis Function #
###### Not included in paper ######
###################################
set.seed(1)
svmRTuned <- train(ptrain, ytrain,
                   method = "svmRadial",
                   preProc = c("center", "scale"),
                   tuneLength = 14,
                   trControl = trainControl(method = "cv"))
svmRTuned
svm_pred<-predict(svmRTuned,ptest);
postResample(pred=svm_pred,obs=ytest)

#### Plots for SVM Model ###
#RMSE~Cost
ggplot(svmRTuned)+coord_trans(x='log2')

#Actual~Predicted
svm_Model = lm(ytest~svm_pred)
plot(svm_Model, col = 4)
plot(svm_pred~ytest, xlab = "Predicted", ylab = "Actual")

#Ordered Observations~Model
x = 1:length(ytest)
plot(x, ytest, pch=18, col="red", xlab ="", ylab = "", ylim=c(0,90000), main = "Support Vector Machine Model Fit")
lines(x, svm_pred, lwd="1", col="blue")
abline(lm(svm_pred~x), col = "black")

#Res~Fit for Actual~Predicted
svmRes = rstandard(svm_Model)
plot(svmRes~fitted(svm_Model), ylab = "Residuals", xlab = "Fitted Values", 
     main = "Support Vector Machine", col = 10)

plot(svm_pred~ytest, xlab = "Predicted", ylab = "Actual", col = "blue", 
     main = "Support Vector Machine", ylim = c(0,90000), xlim = c(0,80000))
abline(lm(ytest~svm_pred), col="red")
####
####################################################
####
####

###########################
### Second SVM modeling ###
#### Included in Paper ####
###########################

sigmaRangeReduced <- sigest(as.matrix(ptrain)); sigmaRangeReduced
svmRGridReduced <- expand.grid(.sigma = sigmaRangeReduced,
                               .C = 2^(seq(-4, 6)))


svmR2Tuned <- train(ptrain, ytrain,
                   method = "svmRadial",
                   preProc = c("center", "scale"),
                   tuneLength = 14,
                   tuneGrid = svmRGridReduced,
                   trControl = trainControl(method = "cv"))


svmR2Tuned

svm2_pred<-predict(svmR2Tuned,ptest);
postResample(pred=svm_pred,obs=ytest)

#### Support Vector Machine 2 Plot ###
###
#RMSE
ggplot(svmR2Tuned)+coord_trans(x='log2') 

svm2_Model = lm(ytest~svm2_pred)
plot(svm2_Model, col = 4)
plot(ytest~svm2_pred, xlab = "Predicted", ylab = "Actual",
     ylim = c(0,90000), main="Support Vector Machine", col = "blue")
abline(svm2_Model, col = "red")


#Ordered Observations~Model
x = 1:length(ytest)
plot(x, ytest, col=12, xlab ="", ylab = "", ylim=c(0,90000), main = "Support Vector Machine Model Fit")
lines(x, svm_pred, lwd="1", col="red")
abline(lm(svm_pred~x), col = "black")

#Res~Fit for Actual~Predicted
svm2Res = rstandard(svm2_Model)
plot(svm2Res~fitted(svm2_Model), ylab = "Residuals", xlab = "Fitted Values", 
     main = "Support Vector Machine", col = 10)



####PLS 
set.seed(1)
plsmod<-train(ptrain,ytrain,method="pls",trControl=ctrl)
plsmod
plot(plsmod)
pls_pred<-predict(plsmod,ptest)
postResample(pred=pls_pred,obs=ytest)


####bestmodel
library("vip")
vip(svmR2Tuned)
vip(marsTuned)
vip(nnetTune)
vip(elas)
vip(lass)
vip(lmod)
vip(rid)
?vip()
